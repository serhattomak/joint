import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerStructuralQuery, buildVaultSummary } from './ai-context';

/**
 * Yapısal sorgu + arşiv özeti AI OLMADAN çalışır. Bu test, AI modülüne hiç
 * dokunmadan yalnızca DB katmanını taklit eder; deterministik yolun kanıtıdır.
 */
const m = vi.hoisted(() => ({
  select: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  listItemsPage: vi.fn(),
  listCategoriesWithCounts: vi.fn(),
  listTagsWithCounts: vi.fn(),
}));

vi.mock('./db/client', () => ({
  getDb: async () => ({ select: m.select }),
  listCategories: m.listCategories,
  listTags: m.listTags,
  listItemsPage: m.listItemsPage,
  listCategoriesWithCounts: m.listCategoriesWithCounts,
  listTagsWithCounts: m.listTagsWithCounts,
  ITEM_SORTS: ['new', 'old', 'title', 'title-desc'],
}));

const notebookRow = {
  id: 'i1',
  url: 'https://youtube.com/x',
  title: 'Rust async',
  note: null,
  platform: 'youtube',
  thumbnail: null,
  favorite: false,
  collection_id: null,
  user_id: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  local_path: null,
  download_status: 'none',
  download_error: null,
  converted_path: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.select.mockImplementation(async (sql: string) => {
    if (sql.includes('GROUP BY platform')) {
      return [
        { platform: 'youtube', n: 3 },
        { platform: 'instagram', n: 1 },
      ];
    }
    if (sql.includes('DISTINCT platform')) return [{ platform: 'youtube' }, { platform: 'instagram' }];
    if (sql.includes('favorite = 1')) return [{ n: 2 }];
    if (sql.includes('local_path IS NOT NULL')) return [{ n: 1 }];
    return [];
  });
  m.listCategories.mockResolvedValue([{ id: 'c1', name: 'Yemek' }]);
  m.listTags.mockResolvedValue([{ id: 't1', name: 'rust' }]);
  m.listItemsPage.mockResolvedValue({ rows: [notebookRow], total: 1 });
  m.listCategoriesWithCounts.mockResolvedValue([{ id: 'c1', name: 'Yemek', count: 3 }]);
  m.listTagsWithCounts.mockResolvedValue([{ id: 't1', name: 'rust', count: 2 }]);
});

describe('answerStructuralQuery — AI olmadan yapısal sorgu', () => {
  it("yapısal sinyal yoksa null döner (içerik sorusu LLM'e kalır)", async () => {
    expect(await answerStructuralQuery('Rust async nasıl çalışır?')).toBeNull();
  });

  it('sayı sorusunu DB sorgusuna çevirip kesin metin üretir', async () => {
    const out = await answerStructuralQuery('Yemek kategorisinde kaç kayıt var?');
    expect(out).not.toBeNull();
    expect(out?.query.category).toBe('Yemek');
    expect(out?.count).toBe(1);
    expect(out?.text).toContain('1 kayıt');
    expect(out?.text).toContain('Yemek');
  });
});

describe('buildVaultSummary — AI olmadan arşiv özeti', () => {
  it('sayısal arşiv özeti üretir', async () => {
    const out = await buildVaultSummary();
    expect(out).toContain('Arşiv: 4 kayıt');
    expect(out).toContain('youtube (3)');
  });
});
