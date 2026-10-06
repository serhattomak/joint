import { describe, expect, it } from 'vitest';
import { MIGRATIONS, planMigrations } from './migrations';
import { toItemAnalysis } from './item_analysis';

describe('migration 6 — item_analysis', () => {
  it('planlanan göçlerde v6 vardır ve tabloyu kurar', () => {
    const pending = planMigrations(5);
    const v6 = MIGRATIONS.find((m) => m.version === 6);
    expect(v6).toBeTruthy();
    expect(pending.map((m) => m.version)).toEqual([6]);
    expect(v6!.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS item_analysis');
    // Faz 2 alanı Faz 1'de rezerve:
    expect(v6!.statements.join('\n')).toContain('visual_notes_json');
  });

  /* CASCADE/UNIQUE için gerçek davranış (item silince satır gider; item başına
     tek satır) DB entegrasyon testi gerektirir; bu repoda saf + migration
     statement altyapısı var. Tanımı burada teyit ediyoruz — davranış testi
     raporda "ertelendi" olarak not düşüldü. */
  it('item_analysis CASCADE + UNIQUE tanımı schema ve v6 statement\u2019ında', () => {
    const create = (statements: string[]): string =>
      statements.find((s) => s.includes('CREATE TABLE IF NOT EXISTS item_analysis')) ?? '';
    const def = /item_id\s+TEXT NOT NULL UNIQUE REFERENCES items\(id\) ON DELETE CASCADE/;
    expect(def.test(create(MIGRATIONS[0].statements))).toBe(true); // schema.sql
    expect(def.test(create(MIGRATIONS.find((m) => m.version === 6)!.statements))).toBe(true);
  });
});

describe('toItemAnalysis', () => {
  const row = {
    id: 'a1', item_id: 'i1', status: 'done', contains_recipe: 1, confidence: 0.82,
    language: 'tr', summary: 'özet', recipe_json: '{"title":"Kek","ingredients":["un"],"steps":["kar"],"notes":""}',
    topics_json: '["Yemek"]', keywords_json: '["kek","fırın"]', visual_notes_json: null,
    transcript_source: 'whisper', transcript_path: 'x.srt', model_versions_json: '{"llm":"14b"}',
    error_message: null, analyzed_at: '2026-10-06T00:00:00Z',
    created_at: 'c', updated_at: 'u',
  };
  it('0/1 boolean, JSON kolonlarını çözer', () => {
    const a = toItemAnalysis(row as never);
    expect(a.contains_recipe).toBe(true);
    expect(a.recipe).toEqual({ title: 'Kek', ingredients: ['un'], steps: ['kar'], notes: '' });
    expect(a.topics).toEqual(['Yemek']);
    expect(a.keywords).toEqual(['kek', 'fırın']);
    expect(a.visual_notes).toBeNull();
  });
  it('bozuk JSON\'da çökmez, null/[] döner', () => {
    const a = toItemAnalysis({ ...row, recipe_json: '{bozuk', topics_json: 'x' } as never);
    expect(a.recipe).toBeNull();
    expect(a.topics).toEqual([]);
  });
});
