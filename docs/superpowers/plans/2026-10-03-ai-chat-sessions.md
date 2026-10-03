# Kasa Asistanı — Oturumlu Sohbet ve Kasa Hâkimiyeti Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasa Asistanı'na kalıcı oturum geçmişi, çok turlu sohbet ve kasanın yapısal verisine hâkim (kasa özeti + görünür `action:query`) bir yanıt hattı kazandırmak.

**Architecture:** Sohbet oturumları ve mesajları SQLite'ta (göç 5) yaşar; kalıcılık `lib/db/chat.ts`'te, kasaya hakimiyet `lib/ai-context.ts`'te, saf yardımcılar `lib/ai-chat.ts`'te toplanır. `lib/ai.ts` içindeki `askVault` çok turlu ve iki geçişli hale gelir (sorgu eylemi → TS'te SQLite → sonuçla ikinci üretim). Rust'a yalnızca `export_backup` filtresi genelleştirilerek dokunulur.

**Tech Stack:** Tauri v2, React 19, TypeScript, Vite, Tailwind v4 (`@theme`), `@base-ui/react`, lucide-react, `@tauri-apps/plugin-sql`, Vitest (`node:sqlite` ile şema/göç testleri).

**Spec:** `docs/superpowers/specs/2026-10-03-ai-chat-sessions-design.md`

## Global Constraints

- Arayüzün tamamı Türkçe; `tr-TR` tarih biçimi, "sen" hitabı, sıcak-teknik ton.
- Çevrimdışı: çalışma anında uzak kaynak çekilmez; yerel modeller (Qwen 2.5, BGE-M3) korunur.
- Performans bütçesi: 1000+ öğe. Liste SQL'de sayfalanır, `content-visibility` korunur; özet/arama sorguları indekslidir.
- Göçler YALNIZCA ileri yöndedir; göç öncesi yedek zorunludur (mevcut `runMigrations` + `beforeApply` akışı).
- Yeni npm paketi eklenmez (gerekmedikçe); yalnızca mevcut bağımlılıklar ve Rust komutları kullanılır.
- Tasarım: `DESIGN.md` sözleşmesi. Kart = `settings-card` (opak), kart içine kart yok, sağ bloklar sabit genişlik, hareket `ease-out`/`scale(.97)`, `prefers-reduced-motion`/`-transparency` ele alınır.
- Erişilebilirlik: WCAG AA, klavye ile tam erişim, renk tek başına anlam taşımaz (ikon + sözcük).
- Dokunulmazlar: mevcut özellikler, IPC/veri akışları, Türkçe metinler, `action:tag` davranışı.
- Doğrulama: `npm run typecheck && npm run lint && npm run test && npm run build` + `cargo check`.

## Review Focus

Aşağıdaki girdiler/bozulmalar bir kullanıcıyı en olası yaralayacak olanlardır; her biri sahibi olan göreve **test** olarak eklenir:

1. **Bozuk/geçersiz `action:query`** (JSON değil, bilinmeyen filtre, negatif limit) → uygulama çökmez; normal yanıta düşer. *(Task 2 + Task 4 testleri)*
2. **FTS aramasında özel karakter** (`"`, `*`, `AND`, `(`, boş) → SQL hatası yok; boş sorguda arama atlanır. *(Task 2 — `sanitizeFtsQuery`)*
3. **Çok uzun sohbet** → bağlam taşmaz; en yeni mesaj(lar) korunur, en eski kırpılır. *(Task 2 — `buildHistoryWindow`)*
4. **Var olmayan etiket/kategori adıyla sorgu** → uydurma değil, dürüst "0 sonuç". *(Task 4 — manuel doğrulama)*
5. **Boş oturumun dışa aktarımı / `action` bloğu içeren mesaj** → markdown temiz, çökmez, eylem blokları yazılmaz. *(Task 2 — `formatChatMarkdown`)*

---

## Task 1: Göç 5 — sohbet tabloları ve FTS

**Files:**
- Modify: `jointvault/src/lib/db/migrations.ts` (diziye yeni göç eklenir)
- Test: `jointvault/src/lib/db/migrations.test.ts`

**Interfaces:**
- Consumes: mevcut `MIGRATIONS`, `runMigrations`, `Migration`, `sqliteExecutor` (test).
- Produces: `MIGRATIONS` son elemanı `{ version: 5, description: 'sohbet oturumları ve mesajları' }`. Tablolar: `ai_chat_sessions(id,title,pinned,created_at,updated_at)`, `ai_chat_messages(id,session_id,role,content,references_json,created_at)`, `ai_chat_messages_fts` (fts5).

- [ ] **Step 1: Başarısız testi yaz** — `migrations.test.ts` sonuna ekle:

```ts
describe('runMigrations — göç 5 (sohbet)', () => {
  const chatTables = (db: DatabaseSync): string[] =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ai_chat_sessions','ai_chat_messages','ai_chat_messages_fts') ORDER BY name",
      )
      .all()
      .map((r) => String((r as { name: unknown }).name));

  it('taze kasada sohbet tablolarını kurar', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');

    // Act
    await runMigrations(sqliteExecutor(db));

    // Assert
    expect(chatTables(db)).toEqual(['ai_chat_messages', 'ai_chat_messages_fts', 'ai_chat_sessions']);
  });

  it('eski kasada veriyi koruyarak sohbet tablolarını ekler', async () => {
    // Arrange
    const db = schemaAtVersionZero();
    db.exec("INSERT INTO items (id, url, platform) VALUES ('i1', 'https://a', 'x')");

    // Act
    const result = await runMigrations(sqliteExecutor(db));

    // Assert
    expect(result.to).toBe(LATEST);
    expect(chatTables(db)).toContain('ai_chat_sessions');
    expect(db.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 1 });
  });

  it('mesaj FTS tablosu MATCH ile aranabilir', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    await runMigrations(sqliteExecutor(db));

    // Act
    db.exec("INSERT INTO ai_chat_sessions (id, title) VALUES ('s1', 'Rust')");
    db.exec("INSERT INTO ai_chat_messages (id, session_id, role, content) VALUES ('m1','s1','user','async rust notlari')");
    db.exec("INSERT INTO ai_chat_messages_fts (message_id, session_id, content) VALUES ('m1','s1','async rust notlari')");
    const hits = db
      .prepare("SELECT message_id FROM ai_chat_messages_fts WHERE ai_chat_messages_fts MATCH 'rust'")
      .all();

    // Assert
    expect(hits.map((r) => String((r as { message_id: unknown }).message_id))).toEqual(['m1']);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- migrations` (workdir `jointvault`)
Expected: FAIL — `expect(...).toContain('ai_chat_sessions')` / tablo listesi eksik.

- [ ] **Step 3: Göçü ekle** — `MIGRATIONS` dizisine son eleman olarak:

```ts
{
  version: 5,
  description: 'sohbet oturumları ve mesajları',
  statements: [
    `CREATE TABLE IF NOT EXISTS ai_chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
    'CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(pinned DESC, updated_at DESC)',
    `CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      references_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
    'CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id, created_at)',
    `CREATE VIRTUAL TABLE IF NOT EXISTS ai_chat_messages_fts USING fts5(
      message_id UNINDEXED, session_id UNINDEXED, content, tokenize = 'unicode61'
    )`,
  ],
},
```

> Not: `schema.sql` sürüm-1 tabanıdır; dokunulmaz. `schema.test.ts` beklenen tablo listesi bu yüzden değişmez.

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `npm test -- migrations`
Expected: PASS (tüm migration testleri).

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/db/migrations.ts jointvault/src/lib/db/migrations.test.ts
git commit -m "feat(db): goc 5 - sohbet oturumlari ve mesajlari + FTS"
```

---

## Task 2: `lib/ai-chat.ts` — saf yardımcılar

**Files:**
- Create: `jointvault/src/lib/ai-chat.ts`
- Test: `jointvault/src/lib/ai-chat.test.ts`

**Interfaces:**
- Consumes: hiçbir şey (saf, bağımsız).
- Produces:
  - `interface HistoryMessage { role: 'user' | 'assistant'; content: string }`
  - `interface VaultQueryItem { id: string; title: string | null; url: string; platform: string; favorite: boolean; downloaded: boolean; createdAt: string }`
  - `interface ActionTagPayload { itemId: string; itemTitle?: string; categories?: string[]; tags?: string[] }`
  - `interface ActionQueryPayload { filters?: Record<string, unknown>; limit?: number; countOnly?: boolean }`
  - `parseAssistantMessage(content: string): { cleanContent: string; actionTag: ActionTagPayload | null; actionQuery: ActionQueryPayload | null }`
  - `buildHistoryWindow(messages: HistoryMessage[], charBudget: number): HistoryMessage[]`
  - `sessionTitleFromFirstMessage(text: string): string`
  - `sanitizeFtsQuery(q: string): string`
  - `formatChatMarkdown(title: string, messages: { role: 'user' | 'assistant'; content: string; created_at: string }[]): string`

- [ ] **Step 1: Başarısız testi yaz** — `ai-chat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildHistoryWindow,
  formatChatMarkdown,
  parseAssistantMessage,
  sanitizeFtsQuery,
  sessionTitleFromFirstMessage,
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
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- ai-chat`
Expected: FAIL — modül yok.

- [ ] **Step 3: Modülü yaz** — `ai-chat.ts`:

Uygulama notları (imzalar yukarıda; gövde basit):
- `parseAssistantMessage`: iki regex — `/```action:tag\s*([\s\S]*?)\s*```/` ve aynısı `query` için; her eşleşmeyi `content`'ten çıkar, `JSON.parse`'ı try/catch ile koru (hata → ilgili eylem `null`).
- `buildHistoryWindow`: sondan başa yürü; kümülatif `content.length` bütçeyi aşana kadar ekle; **her zaman son mesajı ekle** (bütçe 0 olsa bile). Döndürülen sıra giriş sırasıyla aynıdır.
- `sessionTitleFromFirstMessage`: `text.replace(/\s+/g,' ').trim()`; 40'tan uzunsa `slice(0,40) + '…'`; boşsa `'Yeni sohbet'`.
- `sanitizeFtsQuery`: `q.replace(/"/g,' ').replace(/\s+/g,' ').trim()`; boşsa `''`, değilse `"${cleaned}"` (tümce araması).
- `formatChatMarkdown`: `# ${title}\n` ile başla; boşsa onu döndür; her mesaj için `\n## Kullanıcı\n…` / `\n## Asistan\n…`; asistan içeriğini `parseAssistantMessage(...).cleanContent` ile temizle.

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `npm test -- ai-chat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/ai-chat.ts jointvault/src/lib/ai-chat.test.ts
git commit -m "feat(ai): saf sohbet yardimcilari - parse, pencere, markdown, FTS"
```

---

## Task 3: `lib/db/chat.ts` — kalıcılık katmanı

**Files:**
- Create: `jointvault/src/lib/db/chat.ts`

**Interfaces:**
- Consumes: `getDb` (`./client`), `formatChatMarkdown`, `sessionTitleFromFirstMessage`, `sanitizeFtsQuery`, `type VaultQueryItem` (`../ai-chat`, yalnızca tip), `type HybridSearchResult` (`./types`).
- Produces:

```ts
export interface ChatSession { id: string; title: string; pinned: boolean; created_at: string; updated_at: string }
export interface ChatMessageRow { id: string; session_id: string; role: 'user' | 'assistant'; content: string; references_json: string | null; created_at: string }
export interface ChatReferenceSnapshot { chunks?: HybridSearchResult[]; query?: VaultQueryItem[] }
export interface ChatSearchHit { sessionId: string; sessionTitle: string; messageId: string; snippet: string; createdAt: string }

export async function createChatSession(title?: string): Promise<ChatSession>
export async function listChatSessions(): Promise<ChatSession[]>
export async function getChatSession(id: string): Promise<ChatSession | null>
export async function renameChatSession(id: string, title: string): Promise<void>
export async function setChatSessionPinned(id: string, pinned: boolean): Promise<void>
export async function deleteChatSession(id: string): Promise<void>
export async function appendChatMessage(sessionId: string, input: { role: 'user' | 'assistant'; content: string; references?: ChatReferenceSnapshot }): Promise<ChatMessageRow>
export async function listChatMessages(sessionId: string): Promise<ChatMessageRow[]>
export async function searchChatMessages(q: string): Promise<ChatSearchHit[]>
export async function exportSessionMarkdown(sessionId: string): Promise<string | null>
```

- [ ] **Step 1: Modülü yaz** — `chat.ts`:

Uygulama notları:
- `pinned` INTEGER 0/1; sınırda `pinned: r.pinned === 1` (`toSession` eşleyici) — `client.ts`'teki `toItem` deseni.
- `listChatSessions`: `ORDER BY pinned DESC, updated_at DESC`.
- `createChatSession(title = 'Yeni sohbet')`: `crypto.randomUUID()`, `INSERT`.
- `appendChatMessage(input)`: tek `INSERT` mesaj + tek `INSERT` FTS (`message_id`, `session_id`, `content`); ardından `UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?`. **FTS ile ikinci yazım `item_chunks_fts` desenindedir (açık senkron).**
- **Otomatik başlık:** bu fonksiyon ilk `user` mesajından sonra, oturum başlığı hâlâ `'Yeni sohbet'` ise `sessionTitleFromFirstMessage(content)` ile günceller (`ai-chat`'ten içe aktarılır). Elle adlandırılmış başlık ezilmez.
- `searchChatMessages(q)`: `sanitizeFtsQuery(q)` (`ai-chat`) boşsa `[]` döndür. Değilse:
  `SELECT m.id AS messageId, m.session_id AS sessionId, s.title AS sessionTitle, m.created_at AS createdAt, snippet(ai_chat_messages_fts, 2, '', '', '…', 12) AS snippet FROM ai_chat_messages_fts f JOIN ai_chat_messages m ON m.id = f.message_id JOIN ai_chat_sessions s ON s.id = m.session_id WHERE ai_chat_messages_fts MATCH ? ORDER BY m.created_at DESC LIMIT 50`
- `deleteChatSession(id)`: önce `DELETE FROM ai_chat_messages_fts WHERE session_id = ?`, sonra `DELETE FROM ai_chat_sessions WHERE id = ?` (mesajlar FK CASCADE).
- `exportSessionMarkdown(id)`: oturum yoksa `null`; değilse mesajları `listChatMessages` ile alıp `formatChatMarkdown(session.title, rows)` döndür.
- `references_json`: `input.references` verilirse `JSON.stringify`, yoksa `null`.

- [ ] **Step 2: Tip kontrolünden geçtiğini doğrula**

Run: `npm run typecheck` (workdir `jointvault`)
Expected: PASS — `ai-chat.ts` (Task 2) mevcut olduğu için tip ve import çözülür; henüz başka tüketici yok.

- [ ] **Step 3: Commit**

```bash
git add jointvault/src/lib/db/chat.ts
git commit -m "feat(db): sohbet oturum/mesaj kalicilik katmani + FTS arama"
```

---

## Task 4: `lib/ai-context.ts` — kasa zemini + `client.ts` `sinceDays`

**Files:**
- Create: `jointvault/src/lib/ai-context.ts`
- Modify: `jointvault/src/lib/db/client.ts` (`ItemFilters` + `listItemsPage`)
- Test: `jointvault/src/lib/ai-context.test.ts`

**Interfaces:**
- Consumes: `listItemsPage`, `listItems`, `listTags`, `listCategories`, `listCategoriesWithCounts`, `listTagsWithCounts`, `getDb` (`./db/client`), `ItemSort` tipi, `type VaultQueryItem` (`./ai-chat`, Task 2).
- Produces:

```ts
export interface VaultQuery {
  query?: string; platform?: string; tag?: string; category?: string;
  favorite?: boolean; downloaded?: boolean; sinceDays?: number;
  sort?: ItemSort; limit?: number; countOnly?: boolean;
}
export function normalizeVaultQuery(raw: unknown): VaultQuery
export async function buildVaultSummary(): Promise<string>
export async function executeVaultQuery(q: VaultQuery): Promise<{ count: number; items: VaultQueryItem[] }>
```

- [ ] **Step 1: `client.ts`'e `sinceDays` ekle** — `ItemFilters` arayüzüne `sinceDays?: number;` ekle; `listItemsPage` koşul üretiminde:

```ts
if (typeof f.sinceDays === 'number' && f.sinceDays > 0) {
  conds.push('i.created_at >= ?');
  params.push(new Date(Date.now() - f.sinceDays * 86_400_000).toISOString());
}
```

- [ ] **Step 2: Başarısız testi yaz** — `ai-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeVaultQuery } from './ai-context';

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
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- ai-context`
Expected: FAIL — modül yok.

- [ ] **Step 4: Modülü yaz** — `ai-context.ts`:

Uygulama notları:
- `normalizeVaultQuery`: `typeof raw === 'object' && raw !== null` değilse `{}`. Alanları yukarıdaki testlere göre normalize et. `countOnly` da katı boolean (`'true'`→true, `'false'`→false, diğer→undefined).
- `buildVaultSummary()`:
  - `SELECT platform, COUNT(*) AS n FROM items GROUP BY platform ORDER BY n DESC`
  - favori sayısı (`favorite = 1`), yerel sayısı (`local_path IS NOT NULL`), toplam.
  - `listCategoriesWithCounts()` ve `listTagsWithCounts()` (mevcut; sayaçlı) → en çok ilk 10.
  - son 8: `listItemsPage(8, 0, { sort: 'new' })`.
  - Türkçe, kısa satırlar halinde bir metin; **~1200 karakter tavanı** (aşılırsa kes ve `…` ekle).
- `executeVaultQuery(q)`:
  - `tag`/`category` **adlarını** id'ye çevir: `listTags()` / `listCategories()` içinde `name.toLowerCase()` eşleşmesi; bulunamazsa `{ count: 0, items: [] }` döndür (uydurma yok).
  - `listItemsPage(limit ?? 10, 0, { query, platform, tagId, categoryId, favoritesOnly: favorite, downloadedOnly: downloaded, sinceDays, sort })`.
  - `countOnly` ise `items: []` ve yalnızca `total`; değilse `rows`'u `VaultQueryItem`'a eşle (`downloaded: r.local_path !== null`).

- [ ] **Step 5: Testleri çalıştır, geçtiğini gör**

Run: `npm test -- ai-context` ve `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jointvault/src/lib/ai-context.ts jointvault/src/lib/ai-context.test.ts jointvault/src/lib/db/client.ts
git commit -m "feat(ai): kasa ozeti + yapisal sorgu (normalize/execute) + sinceDays"
```

---

## Task 5: `lib/ai.ts` — çok turlu ve iki geçişli RAG

**Files:**
- Modify: `jointvault/src/lib/ai.ts` (`askVault`, yeni import'lar)

**Interfaces:**
- Consumes: `buildVaultSummary`, `executeVaultQuery`, `VaultQuery`, `VaultQueryItem` (Task 4); `parseAssistantMessage`, `buildHistoryWindow`, `HistoryMessage` (Task 2); mevcut `streamAiChat`, `searchHybridChunks`, `generateEmbeddings`, `getAiStatus`, `isAiEnabled`.
- Produces:

```ts
export interface RagResult {
  answer: string;
  references: HybridSearchResult[];
  queryItems?: VaultQueryItem[];
}
export async function askVault(
  query: string,
  opts?: {
    history?: ChatMessage[];
    onToken?: (token: string) => void;
    onStatus?: (status: 'streaming' | 'querying') => void;
  },
): Promise<RagResult>
```

- [ ] **Step 1: `askVault`'u yeni imzaya taşı**

Not: Tek çağıran `AiAssistantView`'dur; eski `(query, onToken)` imzası kaldırılır (Task 6 çağrıyı günceller). Ara adımda typecheck kırılabilir; bu görev Task 6 ile aynı commit'te yeşile iner **VEYA** geçici olarak eski imzayı koruyan bir sarmalayıcı bırakılır. Tercih: Task 6 ile birlikte bitir.

- [ ] **Step 2: Akışı uygula**

Uygulama notları:
1. Mevcut durum kapıları (`isAiEnabled` / `engine_available` / `llm_ready`) aynen korunur.
2. `const summary = await buildVaultSummary();` → sistem promptuna `KASA ÖZETİ:\n${summary}` bölümü eklenir (mevcut `KAYNAKLAR` bölümü korunur).
3. Sistem promptuna sorgu eylemi sözleşmesi eklenir:

```
YAPISAL SORGU: Yanıtlamak için kasadan yapısal veri (filtre, liste, sayım; ör. "kaç favorim var", "Rust etiketli YouTube kayıtları", "son 30 gün") gerekiyorsa, SADECE şu bloğu yaz ve başka hiçbir şey yazma:
```action:query
{ "filters": { "platform": "youtube", "tag": "rust", "favorite": true, "sinceDays": 30, "query": "async", "sort": "new" }, "limit": 20, "countOnly": false }
```
Gerekmiyorsa normal, doğal yanıt ver. Uydurma; yalnızca verilen kaynak ve sorgu sonuçlarına dayan.
```

4. `const window = buildHistoryWindow((opts?.history ?? []).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })), 6000);`
5. `onStatus?.('streaming');` → `streamAiChat(jobId, [...window, { role: 'user', content: query }], systemPrompt, onToken)`.
6. Yanıtı `parseAssistantMessage(answer)` ile ayrıştır:
   - `actionQuery` varsa ve **henüz sorgu yapılmadıysa**:
     - `onStatus?.('querying')`
     - `const q = normalizeVaultQuery(actionQuery.filters ?? actionQuery)` → `executeVaultQuery(q)`
     - sonuç bağlamı: `const resultText = countOnly ? \`Kasa sorgusu sonucu: ${count} kayıt.\` : \`Kasa sorgusu sonucu (${count}):\n${items.map(i => \`- ${i.title ?? i.url} [${i.platform}] ${i.createdAt.slice(0,10)}\`).join('\n')}\``
     - **2. geçiş:** `answer = await streamAiChat(newJobId, [...window, { role:'user', content: query }, { role:'assistant', content: actionBlock }, { role:'user', content: resultText + '\n\nBu sonuca dayanarak soruyu yanıtla.' }], systemPrompt, onToken)`; `onStatus?.('streaming')` başında.
   - `actionTag` varsa: mevcut `action:tag` davranışı korunur (istem zaten eylem bloğunu tarif ediyor; `cleanContent` kullanıcıya gider).
7. Dönüş: `{ answer: parseAssistantMessage(answer).cleanContent, references, queryItems: querySonucu?.items }`.

- [ ] **Step 3: Tip kontrolü**

Run: `npm run typecheck` (workdir `jointvault`)
Expected: Task 6 tamamlanana kadar `AiAssistantView` çağrısında hata olabilir; hata yalnızca çağrı yerindeyse kabul. Task 6'dan sonra PASS.

- [ ] **Step 4: Commit** (Task 6 ile birlikte)

---

## Task 6: Sohbet yüzeyi UI + dışa aktarma

**Files:**
- Modify: `jointvault/DESIGN.md` (yeni bölüm)
- Create: `jointvault/src/components/ChatHistoryPanel.tsx`
- Create: `jointvault/src/components/ChatMessages.tsx`
- Modify: `jointvault/src/components/AiAssistantView.tsx`
- Modify: `jointvault/src-tauri/src/settings.rs` (`export_backup` filtre parametreleri)

**Interfaces:**
- Consumes: `lib/db/chat.ts` (Task 3), `lib/ai-chat.ts` (Task 2), `askVault` yeni imzası (Task 5), mevcut `ui/*` primitifleri, `ConfirmDialog`.
- Produces: çalışan sohbet ekranı; `ChatHistoryPanel({ sessions, activeId, onSelect, onCreate, onRename, onTogglePin, onDelete, search, onSearch })`; `ChatMessages({ messages, onOpenItem, busy, status })`.

- [ ] **Step 1: `DESIGN.md` sözleşmesini güncelle**

`## Asistan (sohbet) yüzeyi` bölümü ekle: sol geçmiş paneli (244px, `material-rail` dilinde; dar pencerede çekmece), oturum satırı dili, mesaj balonu, durum sözcükleri (`akıyor` / `kasa taranıyor` / `hata`), "Bulunan Kayıtlar" kartı (sabit sütun/başlık), dışa aktarma. Kart = `settings-card`; kart içine kart yok. **Kod yazmadan önce bu adım bitirilir.**

- [ ] **Step 2: `settings.rs` dışa aktarma filtresini genelleştir**

`export_backup` imzasına opsiyonel alanlar ekle (mevcut çağrılar değişmez):

```rust
pub async fn export_backup(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
```

`add_filter` satırını `filter_name.as_deref().unwrap_or("JSON")` ve `extensions.as_deref().unwrap_or(&["json"])` ile kur. Varsayılan dosya adı `"jointvault-backup.json"` kalır.

- [ ] **Step 3: `ChatHistoryPanel.tsx` yaz**

- Üstte arama alanı (`ui/input`) → `onSearch(q)`; sonuçlar `searchChatMessages` ile `AiAssistantView`'da çekilir ve panele `searchResults` olarak geçirilir (tıklayınca oturum + mesaja kaydır).
- "+ Yeni sohbet" düğmesi → `onCreate`.
- `Sabitlenenler` / `Diğer` grupları; satır: başlık (`truncate`) + göreli tarih (`data-num`); aktif vurgu; `ui/menu` ile `Sabitle/Kaldır · Adlandır · Sil` (Sil → `ConfirmDialog`).
- Dar pencerede çekmece (`Drawer`/`Collapsible`); açık/kapalı `localStorage` `jv-ai-history`.

- [ ] **Step 4: `ChatMessages.tsx` yaz**

- Mevcut balon düzeni `AiAssistantView`'dan taşınır (kullanıcı sağ/primary, asistan sol/card).
- Asistan içeriği `parseAssistantMessage(...).cleanContent` ile render edilir; `actionTag` onay kartı korunur.
- `actionQuery`/`queryItems` sonucu **"Bulunan Kayıtlar"** kartı: her kayıt başlık · platform rozeti · tarih · `onOpenItem(item.id)`.
- `status === 'querying'` iken mesaj balonunda "Kasa taranıyor…" (spinner + metin).
- Streaming imleci korunur.

- [ ] **Step 5: `AiAssistantView.tsx`'i orkestratöre indir**

- Açılışta: `listChatSessions()` → `localStorage` `jv-ai-session` varsa onu, yoksa ilk oturumu seç; hiç oturum yoksa `createChatSession()`.
- Mesaj gönder: kullanıcı mesajını `appendChatMessage(sessionId, { role:'user', content })` ile **önce** yaz; `askVault(q, { history, onToken, onStatus })`; sonucu `appendChatMessage(sessionId, { role:'assistant', content: answer, references: { chunks: references, query: queryItems } })` ile yaz; oturum listesini tazele.
- `askVault` geçmişi: oturumun son mesajları (`listChatMessages` → `{role,content}`), `buildHistoryWindow` içeride kırpar.
- Başlık: oturum adı (satır içi yeniden adlandır → `renameChatSession`), sabitle, **Dışa Aktar** (`exportSessionMarkdown` → `invoke('export_backup', { content, suggestedName: \`${title}.md\`, filterName: 'Markdown', extensions: ['md'] })`).
- "Yeni sohbet", "Sohbeti Temizle" (oturumu silmek yerine: mesajları temizle → `deleteChatSession` + yeni oturum), sil akışı `ConfirmDialog`.
- AI kapalı/model eksik/boş durumlar mevcut haliyle korunur; geçmiş paneli AI kapalıyken de listeler.

- [ ] **Step 6: Tip kontrolü + lint + test + build**

Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add jointvault/DESIGN.md jointvault/src/components/ChatHistoryPanel.tsx jointvault/src/components/ChatMessages.tsx jointvault/src/components/AiAssistantView.tsx jointvault/src/lib/ai.ts jointvault/src-tauri/src/settings.rs
git commit -m "feat(ai): oturumlu sohbet gecmisi, cok turlu asistan ve disa aktarma"
```

---

## Task 7: Bütünsel doğrulama

**Files:**
- Test: (yeni dosya yok) — mevcut testler + manuel smoke.

- [ ] **Step 1: Tüm kalite kapıları**

Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: dördü de yeşil.

- [ ] **Step 2: Rust derlemesi**

Run: `cargo check` (workdir `jointvault/src-tauri`)
Expected: PASS.

- [ ] **Step 3: Manuel smoke (AI açık)**

Run: `npx tauri dev`
Kontrol listesi:
- [ ] Yeni sohbet oluştur → mesaj gönder → uygulamayı kapat/aç → geçmiş durur.
- [ ] Oturum geç / yeniden adlandır / sabitle / sil çalışır; silme sonrası FTS sonucu kalmaz.
- [ ] Tüm sohbetlerde arama oturum + snippet döner; tıklayınca ilgili mesaja gidilir.
- [ ] "Kaç favorim var?" / "Rust etiketli kayıtlar" → "Kasa taranıyor…" görünür, bulunan kayıtlar listelenir, yanıt sayıya dayanır.
- [ ] Var olmayan etiketle soru → uydurma yok, "0 kayıt".
- [ ] Dışa aktar → `.md` yazılır; `action:` blokları dosyada yok.
- [ ] `action:tag` önerisi hâlâ uygulanabilir.
- [ ] Dar pencere (~640px): geçmiş paneli çekmeceye iner, gezinme kaybolmaz.
- [ ] `prefers-reduced-motion` altında animasyonlar sadeleşir.

- [ ] **Step 4: DESIGN.md tutarlılığı**

Yeni yüzey DESIGN.md'deki sözlüğe uyuyor mu; sapma varsa **önce DESIGN.md** güncellenir.

- [ ] **Step 5: Commit (varsa düzeltmeler)**

```bash
git add -A
git commit -m "chore(ai): sohbet dogrulama duzeltmeleri"
```

---

## Self-Review Notları

- **Spec kapsamı:** §4→Task 1; §5.3→Task 2; §5.1→Task 3; §5.2/§5.5→Task 4; §5.4→Task 5; §6/§7/§8→Task 6; §9→Task 7. Tüm başlıklar bir göreve bağlandı.
- **Tip tutarlılığı:** `askVault` imzası Task 5 ile Task 6 çağrısında aynı; `VaultQueryItem` Task 2'de (saf, bağımlılıksız) tanımlı — Task 3 ve Task 4 yalnızca **tip** olarak içe aktarır (döngü ve sıra sorunu yok); `ChatReferenceSnapshot` alanları (`chunks`/`query`) `HybridSearchResult`/`VaultQueryItem` ile eşleşir.
- **Basitleştirme:** Ayrı `dev/verify-chat-store.mjs` yazılmadı (mevcut `verify-*` deseni ağır); FTS çift-yazımı göç testindeki MATCH turu + Task 7 manuel smoke ile pinlenir. `ponytail:` FTS senkronu `item_chunks_fts` ile aynı açık-senkron deseninde; sapma görülürse tetikleyiciye geçilir.
