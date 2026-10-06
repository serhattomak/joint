import { describe, expect, it } from 'vitest';
import { MIGRATIONS, planMigrations } from './migrations';
import { toItemAnalysis } from './item_analysis';

describe('migration 6 â€” item_analysis', () => {
  it('planlanan gÃ¶Ã§lerde v6 vardÄ±r ve tabloyu kurar', () => {
    const pending = planMigrations(5);
    const v6 = MIGRATIONS.find((m) => m.version === 6);
    expect(v6).toBeTruthy();
    expect(pending.map((m) => m.version)).toEqual([6, 7]);
    expect(v6!.statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS item_analysis');
    // Faz 2 alanÄ± Faz 1'de rezerve:
    expect(v6!.statements.join('\n')).toContain('visual_notes_json');
  });

  /* CASCADE/UNIQUE iÃ§in gerÃ§ek davranÄ±ÅŸ (item silince satÄ±r gider; item baÅŸÄ±na
     tek satÄ±r) DB entegrasyon testi gerektirir; bu repoda saf + migration
     statement altyapÄ±sÄ± var. TanÄ±mÄ± burada teyit ediyoruz â€” davranÄ±ÅŸ testi
     raporda "ertelendi" olarak not dÃ¼ÅŸÃ¼ldÃ¼. */
  it('item_analysis CASCADE + UNIQUE tanÄ±mÄ± schema ve v6 statement\u2019Ä±nda', () => {
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
    language: 'tr', summary: 'Ã¶zet', recipe_json: '{"title":"Kek","ingredients":["un"],"steps":["kar"],"notes":""}',
    topics_json: '["Yemek"]', keywords_json: '["kek","fÄ±rÄ±n"]', visual_notes_json: null,
    transcript_source: 'whisper', transcript_path: 'x.srt', model_versions_json: '{"llm":"14b"}',
    error_message: null, analyzed_at: '2026-10-06T00:00:00Z',
    created_at: 'c', updated_at: 'u',
  };
  it('0/1 boolean, JSON kolonlarÄ±nÄ± Ã§Ã¶zer', () => {
    const a = toItemAnalysis(row as never);
    expect(a.contains_recipe).toBe(true);
    expect(a.recipe).toEqual({ title: 'Kek', ingredients: ['un'], steps: ['kar'], notes: '' });
    expect(a.topics).toEqual(['Yemek']);
    expect(a.keywords).toEqual(['kek', 'fÄ±rÄ±n']);
    expect(a.visual_notes).toBeNull();
  });
  it('bozuk JSON\'da Ã§Ã¶kmez, null/[] dÃ¶ner', () => {
    const a = toItemAnalysis({ ...row, recipe_json: '{bozuk', topics_json: 'x' } as never);
    expect(a.recipe).toBeNull();
    expect(a.topics).toEqual([]);
  });
});

