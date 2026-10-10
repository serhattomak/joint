import { describe, expect, it } from 'vitest';
import type { Category, Item } from './db/types';
import {
  buildCategoryDigest,
  buildNumericSummary,
  extractLinks,
  notebookPageIds,
  planItemMerge,
  sortNotebookItems,
} from './notebook';

const item = (over: Partial<Item>): Item => ({
  id: 'id',
  url: 'https://x.com/a/status/1',
  title: 'T',
  note: null,
  platform: 'x',
  thumbnail: null,
  favorite: false,
  collection_id: null,
  user_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  local_path: null,
  download_status: 'none',
  download_error: null,
  converted_path: null,
  ...over,
}) as Item;

const cat = (id: string, name: string, parent_id: string | null = null): Category => ({
  id,
  name,
  parent_id,
  user_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('notebookPageIds', () => {
  it('YAPRAK OLMAYAN düğümün sayfası kendisini VE torunlarını kapsar', () => {
    // "Tatlı"ya doğrudan bağlı kayıt da, "Sütlü Tatlı" kayıtları da görünür.
    const cats = [cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2')];
    expect(notebookPageIds(cats, '2').sort()).toEqual(['2', '3']);
  });

  it('yaprak düğümün sayfası yalnız kendisi', () => {
    const cats = [cat('1', 'Yemek'), cat('2', 'Tatlı', '1')];
    expect(notebookPageIds(cats, '2')).toEqual(['2']);
  });

  it('bozuk parent_id döngüsünde asılmaz', () => {
    // 2 → 3 → 2: normalde sonsuz döngü; `seen` kümesi keser.
    const cats = [cat('2', 'A', '3'), cat('3', 'B', '2')];
    expect(notebookPageIds(cats, '2').sort()).toEqual(['2', '3']);
  });
});

describe('extractLinks', () => {
  it('markdown linkleri sırasıyla çıkarır ve tekilliştirir', () => {
    const out = extractLinks({
      content_markdown: 'okuyun [A](https://a.com) ve [B](https://b.com); [A](https://a.com)',
      images_json: JSON.stringify([{ url: 'https://a.com' }]),
      videos_json: '[]',
    });
    expect(out).toEqual(['https://a.com', 'https://b.com']);
  });

  it('http(s) dışını elemez, boş girdide boş döner', () => {
    expect(
      extractLinks({
        content_markdown: '[x](data:image/png;base64,AA) [y](ftp://nope)',
        images_json: null,
        videos_json: null,
      }),
    ).toEqual([]);
    expect(extractLinks({ content_markdown: null, images_json: null, videos_json: null })).toEqual(
      [],
    );
  });

  it('bozuk images_json patlamaz', () => {
    expect(extractLinks({ content_markdown: null, images_json: '{bozuk', videos_json: null })).toEqual(
      [],
    );
  });
});

describe('sortNotebookItems', () => {
  it('tarih azalan; eşitlikte başlık A→z', () => {
    const out = sortNotebookItems([
      item({ id: '2', created_at: '2026-01-02T00:00:00Z', title: 'b' }),
      item({ id: '1', created_at: '2026-01-03T00:00:00Z', title: 't' }),
      item({ id: '3', created_at: '2026-01-02T00:00:00Z', title: 'a' }),
    ]);
    expect(out.map((x) => x.id)).toEqual(['1', '3', '2']);
  });
});

describe('planItemMerge', () => {
  it('notlar \\n\\n ile birleşir, favorite OR, created_at min', () => {
    const target = item({ id: 't', note: null, favorite: false, created_at: '2026-02-01T00:00:00Z' });
    const v1 = item({ id: 'v1', note: 'ilk not', favorite: true, created_at: '2026-01-05T00:00:00Z' });
    const v2 = item({ id: 'v2', note: 'ikinci not', favorite: false, created_at: '2026-01-06T00:00:00Z' });
    const plan = planItemMerge(target, [v1, v2]);
    expect(plan.note).toBe('ilk not\n\nikinci not');
    expect(plan.favorite).toBe(true);
    expect(plan.created_at).toBe('2026-01-05T00:00:00Z');
    expect(plan.victimIds).toEqual(['v1', 'v2']);
  });

  it('hedef boşken başlık/kapak dolu victimden taşınır, hedef doluyken korunur', () => {
    const target = item({ id: 't', title: null, thumbnail: null });
    const v = item({ id: 'v', title: 'Tamsay Sadakat', thumbnail: 'https://thumbnail' });
    const plan = planItemMerge(target, [v]);
    expect(plan.title).toBe('Tamsay Sadakat');
    expect(plan.thumbnail).toBe('https://thumbnail');

    const fullTarget = item({ id: 't', title: 'Dolu', thumbnail: 'https://thumb-t' });
    const plan2 = planItemMerge(fullTarget, [v]);
    expect(plan2.title).toBeNull();
    expect(plan2.thumbnail).toBeNull();
  });
});

describe('buildCategoryDigest', () => {
  it('boşluk/küçük-harf tekilliştirir ve tekil metinleri \\n\\n birleştirir', () => {
    const out = buildCategoryDigest(['a metni', 'a metni', 'b metni']);
    expect(out).toBe('a metni\n\nb metni');
  });

  it('maxChars sonunda keser', () => {
    const out = buildCategoryDigest(['x'.repeat(10), 'y'.repeat(10)], 15);
    expect(out.length).toBe(15);
  });
});

describe('buildNumericSummary', () => {
  it('boş sayfada null döner (boş durumu çağıran öğretir)', () => {
    expect(buildNumericSummary([])).toBeNull();
  });

  it('kayıt/platform/yerel sayılarını deterministik üretir', () => {
    const out = buildNumericSummary([
      { platform: 'youtube', local_path: '/a.mp4', created_at: '2026-09-01T00:00:00Z' },
      { platform: 'youtube', local_path: null, created_at: '2026-10-01T00:00:00Z' },
      { platform: 'instagram', local_path: '/b.jpg', created_at: '2026-09-15T00:00:00Z' },
    ]);
    expect(out).toContain('Bu sayfada 3 kayıt.');
    expect(out).toContain('youtube (2), instagram (1)');
    expect(out).toContain('Yerel: 2 · indirilmedi: 1.');
    expect(out).toContain('2026-09-01 – 2026-10-01');
  });

  it('platform sırası adet ↓ sonra ad ↑ (determinizm)', () => {
    const out = buildNumericSummary([
      { platform: 'b', local_path: null, created_at: '2026-01-01T00:00:00Z' },
      { platform: 'a', local_path: null, created_at: '2026-01-01T00:00:00Z' },
      { platform: 'a', local_path: null, created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(out).toContain('a (2), b (1)');
  });
});
