import { describe, expect, it } from 'vitest';
import { mapAnalysisResponse, shouldSkipAnalysis, summarizeBatch } from './analysis';

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
