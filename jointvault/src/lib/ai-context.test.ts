import { describe, expect, it } from 'vitest';
import {
  detectStructuralIntent,
  formatQueryResult,
  normalizeVaultQuery,
  vaultQueryToFilters,
} from './ai-context';

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

const TAX = {
  categories: ['Yemek', 'Yazılım'],
  tags: ['rust', 'tarif'],
  platforms: ['youtube', 'instagram'],
};

describe('detectStructuralIntent', () => {
  it('kategori + kaç → kategori filtresi', () => {
    expect(detectStructuralIntent('Yemek kategorisinde kaç kayıt var?', TAX)).toMatchObject({
      category: 'Yemek',
    });
  });

  it('etiket + platform + listele', () => {
    expect(detectStructuralIntent('Rust etiketli YouTube kayıtlarını listele', TAX)).toMatchObject({
      tag: 'rust',
      platform: 'youtube',
    });
  });

  it('kaç favorim → favori filtresi', () => {
    expect(detectStructuralIntent('Kaç favorim var?', TAX)).toMatchObject({ favorite: true });
  });

  it('favori olmayanlar → favorite=false', () => {
    expect(detectStructuralIntent('Favori olmayan kayıtları göster', TAX)).toMatchObject({
      favorite: false,
    });
  });

  it('son 30 gün → sinceDays', () => {
    expect(detectStructuralIntent('Son 30 günde ne kaydettim?', TAX)).toMatchObject({
      sinceDays: 30,
    });
  });

  it('süre sorusu ("kaç dakika") yapısal sayılmaz', () => {
    expect(detectStructuralIntent('Bu video kaç dakika?', TAX)).toBeNull();
  });

  it('yapısal sinyal yoksa null', () => {
    expect(detectStructuralIntent('Rust async nasıl çalışır?', TAX)).toBeNull();
  });

  it('kategori kelimesi var ama eşleşme yoksa null (yanlış toplam sayı verme)', () => {
    expect(detectStructuralIntent('Bilinmeyen kategori kaç kayıt?', TAX)).toBeNull();
  });
});

describe('formatQueryResult', () => {
  it('filtreyi ve sayıyı yazar', () => {
    const out = formatQueryResult({ category: 'Yemek' }, { count: 12, items: [] });
    expect(out).toContain('12');
    expect(out).toContain('Yemek');
  });

  it('kayıtları listeler', () => {
    const out = formatQueryResult(
      {},
      {
        count: 1,
        items: [
          {
            id: 'i1',
            title: 'Tarif',
            url: 'u',
            platform: 'youtube',
            favorite: false,
            downloaded: false,
            createdAt: '2026-10-03T00:00:00Z',
          },
        ],
      },
    );
    expect(out).toContain('Tarif');
  });
});
