import { describe, expect, it } from 'vitest';
import { normalizeVaultQuery, vaultQueryToFilters } from './ai-context';

describe('normalizeVaultQuery', () => {
  it('boş girdide boş nesne döner', () => {
    expect(normalizeVaultQuery({})).toEqual({});
  });

  it('limit 1..30 aralığına kırpılır', () => {
    expect(normalizeVaultQuery({ limit: 999 }).limit).toBe(30);
    expect(normalizeVaultQuery({ limit: 0 }).limit).toBe(1);
    expect(normalizeVaultQuery({ limit: -5 }).limit).toBe(1);
  });

  it('geçersiz sort atılır, geçerli sort korunur', () => {
    expect(normalizeVaultQuery({ sort: 'DROP TABLE' }).sort).toBeUndefined();
    expect(normalizeVaultQuery({ sort: 'old' }).sort).toBe('old');
  });

  it('sayısal alanları normalize eder, negatif sinceDays atar', () => {
    expect(normalizeVaultQuery({ sinceDays: '30' }).sinceDays).toBe(30);
    expect(normalizeVaultQuery({ sinceDays: -1 }).sinceDays).toBeUndefined();
  });

  it('boolean alanları katı okur', () => {
    expect(normalizeVaultQuery({ favorite: 'true' }).favorite).toBe(true);
    expect(normalizeVaultQuery({ favorite: 'false' }).favorite).toBe(false);
    expect(normalizeVaultQuery({ favorite: 'yes' }).favorite).toBeUndefined();
  });

  it('metin alanlarını kırpar, boşu atar', () => {
    expect(normalizeVaultQuery({ platform: '  youtube ' }).platform).toBe('youtube');
    expect(normalizeVaultQuery({ tag: '   ' }).tag).toBeUndefined();
  });
});

describe('vaultQueryToFilters', () => {
  it('favorite=false korunur (favori olmayanlar)', () => {
    expect(vaultQueryToFilters({ favorite: false })).toMatchObject({ favorite: false });
  });

  it('downloaded true/false hasLocal olarak eşlenir', () => {
    expect(vaultQueryToFilters({ downloaded: true })).toMatchObject({ hasLocal: true });
    expect(vaultQueryToFilters({ downloaded: false })).toMatchObject({ hasLocal: false });
  });

  it('query/sinceDays/sort taşınır', () => {
    expect(vaultQueryToFilters({ query: 'rust', sinceDays: 30, sort: 'old' })).toMatchObject({
      query: 'rust',
      sinceDays: 30,
      sort: 'old',
    });
  });
});
