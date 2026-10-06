import { describe, expect, it } from 'vitest';
import {
  mapAnalysisResponse,
  resolveAnalysisTaxonomy,
  shouldShowRecipe,
  shouldSkipAnalysis,
  summarizeBatch,
} from './analysis';

describe('summarizeBatch', () => {
  it('sonuçları sayar', () => {
    expect(summarizeBatch(['processed', 'failed', 'skipped', 'processed'])).toEqual({
      processed: 2, failed: 1, skipped: 1,
    });
  });
  it('boş → sıfırlar', () => {
    expect(summarizeBatch([])).toEqual({ processed: 0, failed: 0, skipped: 0 });
  });
});

describe('shouldSkipAnalysis', () => {
  it('force yoksa done/partial atlanır; force ile atlanmaz', () => {
    expect(shouldSkipAnalysis({ status: 'done' }, false)).toBe(true);
    expect(shouldSkipAnalysis({ status: 'partial' }, false)).toBe(true);
    expect(shouldSkipAnalysis({ status: 'done' }, true)).toBe(false);
  });
  it('error/running/null yeniden denenir', () => {
    expect(shouldSkipAnalysis({ status: 'error' }, false)).toBe(false);
    expect(shouldSkipAnalysis({ status: 'running' }, false)).toBe(false);
    expect(shouldSkipAnalysis(null, false)).toBe(false);
  });
});

describe('shouldShowRecipe', () => {
  const recipe = { title: 'Kek', ingredients: ['un'], steps: ['kar'], notes: '' };

  it('contains_recipe + confidence ≥ 0.6 + recipe birlikteyse gösterir', () => {
    expect(shouldShowRecipe({ contains_recipe: true, confidence: 0.6, recipe })).toBe(true);
    expect(shouldShowRecipe({ contains_recipe: true, confidence: 0.9, recipe })).toBe(true);
  });
  it('sınır: 0.59 gizli', () => {
    expect(shouldShowRecipe({ contains_recipe: true, confidence: 0.59, recipe })).toBe(false);
  });
  it('confidence null → gizli', () => {
    expect(shouldShowRecipe({ contains_recipe: true, confidence: null, recipe })).toBe(false);
  });
  it('recipe null → gizli (confidence yüksek olsa da)', () => {
    expect(shouldShowRecipe({ contains_recipe: true, confidence: 0.9, recipe: null })).toBe(false);
  });
  it('contains_recipe false/null → gizli', () => {
    expect(shouldShowRecipe({ contains_recipe: false, confidence: 0.9, recipe })).toBe(false);
    expect(shouldShowRecipe({ contains_recipe: null, confidence: 0.9, recipe })).toBe(false);
  });
  it('analiz yok → gizli', () => {
    expect(shouldShowRecipe(null)).toBe(false);
  });
});

describe('resolveAnalysisTaxonomy', () => {
  it('mevcut kategori eşleşmesi eşikten bağımsız korunur (kanonik ad)', () => {
    const r = resolveAnalysisTaxonomy(['Yemek'], [], ['yemek'], [], 0.1, 0.6);
    expect(r.categories).toEqual(['yemek']);
  });
  it('yeni kategori yalnız eşik üstünde kabul edilir', () => {
    expect(resolveAnalysisTaxonomy(['Tatlı'], [], [], [], 0.5, 0.6).categories).toEqual([]);
    expect(resolveAnalysisTaxonomy(['Tatlı'], [], [], [], 0.6, 0.6).categories).toEqual(['Tatlı']);
  });
  it('maxNew=1: en fazla bir YENİ kategori; toplam ≤ 2', () => {
    const r = resolveAnalysisTaxonomy(['A', 'B', 'C'], [], [], [], 0.9, 0.6);
    expect(r.categories).toEqual(['A']);
  });
  it('keyword → etiket, normalize + max 12', () => {
    const keywords = Array.from({ length: 15 }, (_, i) => `#Etiket ${i}`);
    const r = resolveAnalysisTaxonomy([], keywords, [], [], 0.9, 0.6);
    expect(r.tags).toHaveLength(12);
    expect(r.tags[0]).toBe('etiket 0');
  });
  it('etiket mevcut adla eşlenir (kanonik)', () => {
    const r = resolveAnalysisTaxonomy([], ['kek'], [], ['Kek'], 0.9, 0.6);
    expect(r.tags).toEqual(['Kek']);
  });
});

describe('mapAnalysisResponse', () => {
  it('Rust JSON alanlarını domain alanlarına eşler', () => {
    const m = mapAnalysisResponse({
      analysis: { contains_recipe: true, confidence: 0.82, language: 'tr', title: 'Kek',
        summary: 'özet', topics: ['Yemek'], keywords: ['kek'], recipe: { title: 'Kek', ingredients: ['un'], steps: ['kar'], notes: '' } },
      transcript_source: 'whisper', transcript_path: 'x.srt', model_versions: { llm: 'qwen' },
    });
    expect(m.contains_recipe).toBe(true);
    expect(m.confidence).toBe(0.82);
    expect(m.recipe?.ingredients).toEqual(['un']);
    expect(m.topics).toEqual(['Yemek']);
    expect(m.transcript_source).toBe('whisper');
  });
  it('recipe null olabilir', () => {
    const m = mapAnalysisResponse({
      analysis: { contains_recipe: false, confidence: 0.1, language: null, title: null, summary: 's', topics: [], keywords: [], recipe: null },
      transcript_source: 'embedded', transcript_path: '', model_versions: {},
    });
    expect(m.recipe).toBeNull();
    expect(m.contains_recipe).toBe(false);
  });
});
