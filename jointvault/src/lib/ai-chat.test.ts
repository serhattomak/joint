import { describe, expect, it } from 'vitest';
import {
  buildHistoryWindow,
  formatChatMarkdown,
  mergeQueryPayload,
  parseAssistantMessage,
  sanitizeFtsQuery,
  sessionTitleFromFirstMessage,
  type ActionQueryPayload,
} from './ai-chat';

describe('parseAssistantMessage', () => {
  it('düz metni olduğu gibi bırakır', () => {
    expect(parseAssistantMessage('Merhaba')).toEqual({
      cleanContent: 'Merhaba', actionTag: null, actionQuery: null,
    });
  });

  it('action:tag bloğunu ayırır', () => {
    const raw = 'Tamam.\n```action:tag\n{"itemId":"i1","tags":["rust"]}\n```';
    const r = parseAssistantMessage(raw);
    expect(r.cleanContent).toBe('Tamam.');
    expect(r.actionTag?.itemId).toBe('i1');
    expect(r.actionQuery).toBeNull();
  });

  it('action:query bloğunu ayırır', () => {
    const raw = '```action:query\n{"filters":{"platform":"youtube"},"countOnly":true}\n```';
    const r = parseAssistantMessage(raw);
    expect(r.cleanContent).toBe('');
    expect(r.actionQuery?.countOnly).toBe(true);
    expect(r.actionTag).toBeNull();
  });

  it('bozuk JSON bloğunu yok sayar, metni korur', () => {
    const raw = 'Cevap\n```action:query\n{bozuk}\n```';
    const r = parseAssistantMessage(raw);
    expect(r.actionQuery).toBeNull();
    expect(r.cleanContent).toBe('Cevap');
  });
});

describe('buildHistoryWindow', () => {
  const m = (role: 'user' | 'assistant', content: string) => ({ role, content });

  it('boş girdide boş döner', () => {
    expect(buildHistoryWindow([], 100)).toEqual([]);
  });

  it('bütçe altındaysa hepsini korur', () => {
    const all = [m('user', 'aaaa'), m('assistant', 'bbbb')];
    expect(buildHistoryWindow(all, 100)).toEqual(all);
  });

  it('bütçeyi aşınca en eskileri kırpar, sonu korur', () => {
    const all = [m('user', 'aaaa'), m('assistant', 'bbbb'), m('user', 'cccc'), m('assistant', 'dddd')];
    const r = buildHistoryWindow(all, 10);
    expect(r.map((x) => x.content)).toEqual(['cccc', 'dddd']);
  });

  it('bütçe sıfır olsa bile son mesajı korur', () => {
    const all = [m('user', 'aaaa'), m('assistant', 'dddd')];
    expect(buildHistoryWindow(all, 0)).toEqual([m('assistant', 'dddd')]);
  });
});

describe('sessionTitleFromFirstMessage', () => {
  it('kısa metni olduğu gibi alır', () => {
    expect(sessionTitleFromFirstMessage('Rust async')).toBe('Rust async');
  });

  it('satır sonlarını boşluğa indirir ve 40 karakterde keser', () => {
    const long = 'a'.repeat(30) + '\n' + 'b'.repeat(30);
    const r = sessionTitleFromFirstMessage(long);
    expect(r.length).toBe(41); // 40 + '…'
    expect(r.endsWith('…')).toBe(true);
  });
});

describe('sanitizeFtsQuery', () => {
  it('tırnak/tomurcuk gibi FTS özel karakterlerini etkisizleştirir', () => {
    expect(sanitizeFtsQuery('rust "async" AND*')).toBe('"rust async AND*"');
  });

  it('boş/yalnızca boşluk girdide boş döner', () => {
    expect(sanitizeFtsQuery('   ')).toBe('');
  });
});

describe('mergeQueryPayload', () => {
  it('filters varsa üst düzey limit/countOnly korunur', () => {
    expect(mergeQueryPayload({ filters: { favorite: true }, limit: 20, countOnly: true })).toEqual({
      favorite: true,
      limit: 20,
      countOnly: true,
    });
  });

  it('filters yoksa düz alanlar korunur', () => {
    const flat = { platform: 'youtube', countOnly: true } as unknown as ActionQueryPayload;
    expect(mergeQueryPayload(flat)).toEqual({
      platform: 'youtube',
      countOnly: true,
    });
  });
});

describe('formatChatMarkdown', () => {
  it('başlık ve rollerle markdown üretir, action bloklarını yazmaz', () => {
    const md = formatChatMarkdown('Rust', [
      { role: 'user', content: 'soru', created_at: '2026-10-03T10:00:00Z' },
      { role: 'assistant', content: 'cevap\n```action:query\n{bozuk}\n```', created_at: '2026-10-03T10:00:01Z' },
    ]);
    expect(md).toContain('# Rust');
    expect(md).toContain('## Kullanıcı');
    expect(md).toContain('## Asistan');
    expect(md).toContain('cevap');
    expect(md).not.toContain('action:query');
  });

  it('boş oturumda çökmeden başlık döner', () => {
    expect(formatChatMarkdown('Boş', [])).toBe('# Boş\n');
  });
});
