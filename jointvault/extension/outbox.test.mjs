import { describe, expect, it } from 'vitest';
import {
  OUTBOX_KEY,
  canonicalizeUrl,
  enqueue,
  mergeQueue,
  pendingCount,
  removeKeys,
} from './outbox.js';

/** chrome.storage.local'ın kullandığımız yüzeyi (get tek anahtar, set nesne). */
const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
};

describe('canonicalizeUrl', () => {
  it('X gönderisinde sorgu gürültüsünü atar', () => {
    expect(canonicalizeUrl('https://x.com/i/status/1?s=20&t=abc')).toBe('https://x.com/i/status/1');
  });

  it('twitter.com ve www farkını x.com altında birleştirir', () => {
    expect(canonicalizeUrl('https://twitter.com/i/status/1')).toBe('https://x.com/i/status/1');
    expect(canonicalizeUrl('https://x.com/i/status/1/')).toBe('https://x.com/i/status/1');
  });

  it('YouTube video kimliğini korur, youtu.be aynı forma iner', () => {
    expect(canonicalizeUrl('https://www.youtube.com/watch?v=abc&list=PL1&t=30')).toBe(
      'https://www.youtube.com/watch?v=abc',
    );
    expect(canonicalizeUrl('https://youtu.be/abc?si=zz')).toBe('https://www.youtube.com/watch?v=abc');
  });
});

describe('mergeQueue', () => {
  it('kanonik anahtarla tekilleştirir ve yalnızca yenileri sayar', () => {
    const queue = { items: [{ url: 'https://x.com/i/status/1', title: null, thumbnail: null, site: null }] };
    const result = mergeQueue(queue, [
      { url: 'https://twitter.com/i/status/1?s=1' },
      { url: 'https://x.com/i/status/2', title: '  İki  ' },
    ]);
    expect(result.added).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.queue.items.map((i) => i.url)).toEqual([
      'https://x.com/i/status/1',
      'https://x.com/i/status/2',
    ]);
    expect(result.queue.items[1].title).toBe('İki');
  });

  it('tavanı aşınca en eski kayıtları düşürür', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ url: `https://x.com/i/status/${i}` }));
    const result = mergeQueue({ items: [] }, items, 3);
    expect(result.dropped).toBe(2);
    expect(result.queue.items.map((i) => i.url)).toEqual([
      'https://x.com/i/status/2',
      'https://x.com/i/status/3',
      'https://x.com/i/status/4',
    ]);
  });

  it('boş ya da url\'siz kayıtları atlar', () => {
    const result = mergeQueue({ items: [] }, [{ url: '   ' }, {}, { url: 'https://x.com/i/status/9' }]);
    expect(result.added).toBe(1);
    expect(result.queue.items).toHaveLength(1);
  });
});

describe('kuyruk deposu', () => {
  it('enqueue → pendingCount → removeKeys', async () => {
    const storage = fakeStorage();
    await enqueue(storage, [{ url: 'https://x.com/i/status/1' }, { url: 'https://x.com/i/status/2' }]);
    expect(await pendingCount(storage)).toBe(2);

    const remaining = await removeKeys(storage, [canonicalizeUrl('https://twitter.com/i/status/1')]);
    expect(remaining).toBe(1);
    expect(storage.data[OUTBOX_KEY].items[0].url).toBe('https://x.com/i/status/2');
  });

  it('bozuk depoyu boş kuyruk sayar', async () => {
    expect(await pendingCount(fakeStorage({ [OUTBOX_KEY]: 'çöp' }))).toBe(0);
  });
});
