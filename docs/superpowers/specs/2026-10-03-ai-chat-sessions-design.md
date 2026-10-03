# Tasarım: Kasa Asistanı — Oturumlu Sohbet, Kalıcı Geçmiş ve Kasa Hâkimiyeti

Tarih: 2026-10-03
Durum: Onaylandı (konuşma üzerinden) — uygulama planı öncesi spec incelemesi bekliyor
Kapsam: `jointvault/` (Tauri v2 + React 19 + TS + Tailwind v4 + `@base-ui/react`)

## 1. Amaç

Mevcut "Kasa Asistanı" tek turlu ve durumsuzdur: her soru modele tek
`user` mesajı olarak gider, sohbet geçmişi modele taşınmaz ve mesajlar yalnızca
React state'inde yaşar ("Sohbeti Temizle" ile yok olur). Ayrıca asistan kasanın
**yapısal** gerçeğine (etiket, kategori, platform, favori, tarih, sayım) hâkim
değildir; yalnızca chunk (meta/not/transkript/makale) benzerliğiyle çalışır.

Bu iş üç boşluğu kapatır:

1. **Kalıcı sohbet geçmişi** — mesajlar SQLite'ta durur, uygulama yeniden
   açılınca kaybolmaz.
2. **Oturumlu yapı** — birden çok sohbet oturumu; listeleme, geçiş, yeniden
   adlandırma, silme, sabitleme, tüm sohbetlerde tam metin arama, dışa aktarma.
3. **Kasa hâkimiyeti** — modele hafif bir kasa özeti enjekte edilir; asistan
   gerektiğinde *yapısal sorgu eylemi* üretir, arayüz bunu SQLite'ta çalıştırıp
   sonucu modele geri verir (iki geçiş). Böylece "kaç favorim var", "Rust
   etiketli YouTube kayıtları" gibi sorular doğru yanıtlanır.

Onaylanan yaklaşım: **SQLite-native, TS orkestrasyon** (Yaklaşım A). Rust'a
yalnızca dışa aktarma filtresi için dokunulur; `ai_chat_stream` zaten keyfî
`messages[]` kabul ettiği için çok turluluk Rust değişikliği gerektirmez.

## 2. Onaylanan kararlar

| Karar | Seçim |
|---|---|
| Kasa hâkimiyeti mekanizması | Sorgu eylemi (`action:query`) + hafif kasa özeti |
| Oturum kapsamı | Tam özellikli: yeni/listele/geç/adlandır/sil + tam metin arama + sabitle + dışa aktar |
| Yapısal tarama görünürlüğü | Otomatik ve **görünür** (“Kasa taranıyor…”, bulunan kayıtlar referans olarak) |
| Dışa aktarma formatı | Markdown (oturum başına) |
| Sorgu turu tavanı | En fazla 1 tur (`ponytail:` tavan; gerekirse 2'ye çıkarılır) |

## 3. Kapsam dışı (YAGNI)

- Çapraz-oturum uzun-dönem bellek (oturumlar yalıtılmıştır).
- Yerel modelde native function-calling / araç döngüsü (mevcut `action:block`
  metin deseni kullanılır; Rust tool_calls ayrıştırması yapılmaz).
- Bulut API, çok kullanıcı, hesap, senkron sohbet.
- Oturum klasörleme/etiketleme, mesaj düzenleme/dallandırma.

## 4. Veri modeli — Göç 5

`schema.sql` sürüm-1 tabanıdır (mevcut göç 2–4 deseni). Yeni tablolar yalnızca
`MIGRATIONS` dizisine eklenir; taze kasa da tüm göçleri sırayla çalıştırır.

```sql
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(updated_at);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,          -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  references_json TEXT,                   -- JSON anlık görüntü (nullable)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
  ON ai_chat_messages(session_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS ai_chat_messages_fts USING fts5(
  message_id UNINDEXED,
  session_id UNINDEXED,
  content,
  tokenize = 'unicode61'
);
```

FTS senkronizasyonu `item_chunks_fts` ile aynı desende **açıkça** yapılır
(ekle/sil); tetikleyici yok. `deleteChatSession` önce ilgili FTS satırlarını,
sonra oturumu siler (FK CASCADE mesajları temizler).

Sistem mesajları **kalıcı yazılmaz**; yalnızca `user`/`assistant` kaydedilir.

## 5. Modüller ve sorumluluklar

### 5.1 `lib/db/chat.ts` (yeni) — kalıcılık
Tipler:
```ts
interface ChatSession { id: string; title: string; pinned: boolean;
  created_at: string; updated_at: string }
interface ChatMessageRow { id: string; session_id: string;
  role: 'user' | 'assistant'; content: string;
  references_json: string | null; created_at: string }
// references_json (JSON anlık görüntü; her iki alan da opsiyonel olabilir)
interface ChatReferenceSnapshot {
  chunks?: HybridSearchResult[];   // RAG kaynakları
  query?: VaultQueryItem[];        // yapısal sorgu sonuçları
}
interface ChatSearchHit { sessionId: string; sessionTitle: string;
  messageId: string; snippet: string; createdAt: string }
```

- `createChatSession(title?) → ChatSession` — `title` verilmezse `"Yeni sohbet"`;
  ilk kullanıcı mesajı yazıldığında başlık hâlâ varsayılansa ilk ~40 karakterle
  otomatik adlandırılır (kullanıcı adı elle değiştirdiyse ezilmez)
- `listChatSessions() → ChatSession[]` — sıralama `pinned DESC, updated_at DESC`
- `renameChatSession(id, title)`, `setChatSessionPinned(id, pinned)`
- `deleteChatSession(id)` — FTS + oturum (mesajlar CASCADE)
- `appendChatMessage(sessionId, {role, content, references?})` — mesaj + FTS yazımı
  + `updated_at` tazeleme
- `listChatMessages(sessionId) → ChatMessageRow[]` — `created_at ASC`
- `searchChatMessages(q) → ChatSearchHit[]` — FTS join; `{sessionId, sessionTitle,
  messageId, snippet, createdAt}`
- `exportSessionMarkdown(sessionId) → string`

### 5.2 `lib/ai-context.ts` (yeni) — kasaya hakimiyet
- `buildVaultSummary() → Promise<string>`
  - toplam / favori / yerel-indirilmiş sayıları
  - platform kırılımı (sayıya göre azalan, üstte birkaç platform)
  - en çok kullanılan kategoriler ve etiketler + sayaçları
    (`listCategoriesWithCounts`, `listTagsWithCounts` yeniden kullanılır)
  - son 8 kayıt: başlık · platform · tarih
  - ~1200 karakter tavanı (taşarsa kesilir)
- `normalizeVaultQuery(raw) → VaultQuery` (saf) — limit kırpma (1–30), `sort`
  beyaz listesi (`new|old|title|title-desc`), tarih/sayı normalize
- `executeVaultQuery(q) → { count: number; items: VaultQueryItem[] }`
  - mevcut `listItemsPage`'i kullanır; `ItemFilters`'a `sinceDays?: number`
    eklenir (küçük, yeniden kullanılabilir)
  - `countOnly` ise yalnızca `total` döner (items boş)

`VaultQuery` alanları: `query?`, `platform?`, `tag?`, `category?`, `favorite?`,
`downloaded?`, `sinceDays?`, `sort?`, `limit?`, `countOnly?`.
Etiket/kategori adları DB'de id'ye çevrilir (mevcut `listTags`/`listCategories`).

### 5.3 `lib/ai-chat.ts` (yeni) — saf, test edilebilir
- `parseAssistantMessage(content)` — bileşenden dışarı taşınır; `action:tag` VE
  `action:query` bloklarını ayrıştırır → `{ cleanContent, actionTag, actionQuery }`
  (bozuk JSON'da ilgili eylem `null`, içerik korunur)
- `buildHistoryWindow(messages, charBudget) → ChatMessage[]` — sondan geriye
  karakter bütçesiyle kırpar (Qwen context'ini taşırmaz)
- `formatChatMarkdown(session, messages) → string`

### 5.4 `lib/ai.ts` (değişir) — RAG + iki geçiş
`askVault` çok turlu hale gelir:

```ts
askVault(query, {
  history?: ChatMessage[],
  onToken?, onStatus?,          // 'streaming' | 'querying'
}): Promise<RagResult>          // { answer, references, queryItems? }
```

Akış:
1. Durum kapıları (mevcut `isAiEnabled` / motor / model kontrolleri korunur).
2. `buildVaultSummary()` + `searchHybridChunks` (mevcut 5 chunk) + sorgu eylemi
   talimatı → sistem promptu.
3. `buildHistoryWindow` ile geçmiş + kullanıcı mesajı → `streamAiChat`.
4. Yanıt `parseAssistantMessage` ile ayrıştırılır:
   - `action:query` varsa → `onStatus('querying')` → `executeVaultQuery` →
     bulunan kayıtlar → **2. geçiş**: sonuç bağlamı kullanıcı mesajı olarak
     eklenip yeniden `streamAiChat` (canlı).
   - yoksa 1. geçiş yanıtın kendisidir.
5. En fazla **1** sorgu turu; 2. geçişte gelen `action:query` yok sayılır.
6. Referanslar: chunk sonuçları (`HybridSearchResult[]`) ve/veya sorgu kayıtları
   (`VaultQueryItem[]`) döner.

`action:tag` davranışı ve `applyCategorization` çağrısı korunur.

**Sorgu eylemi sözleşmesi** (modele verilen biçim):

```
```action:query
{ "filters": { "platform": "youtube", "tag": "rust", "favorite": true,
               "sinceDays": 30, "query": "async", "sort": "new" },
  "limit": 20, "countOnly": false }
```
```

Kural: asistan yapısal veri gerekiyorsa **yalnızca** bloğu yazar; gerekmiyorsa
normal yanıt verir.

### 5.5 `lib/db/client.ts` (küçük değişiklik)
`ItemFilters`'a `sinceDays?: number`; `listItemsPage` koşul üretimine
`i.created_at >= ?` (ISO tarih) eklenir. Başka değişiklik yok.

## 6. UI

### 6.1 `AiAssistantView.tsx` (orkestratöre iner)
- Aktif oturum: `localStorage` `jv-ai-session` (son seçili); yoksa son oturum ya
  da yeni oturum.
- Mesaj gönder → kullanıcı mesajı kalıcı yazılır → `askVault` (history ile) →
  asistan mesajı (referanslarla) yazılır.
- Durum: `streaming` (mevcut) ve yeni `querying` ("Kasa taranıyor…").
- Başlık: oturum adı (satır içi yeniden adlandır), sabitle, dışa aktar, mevcut
  model/VRAM rozetleri.
- AI kapalı / model eksik / boş durumlar mevcut haliyle korunur.

### 6.2 `ChatHistoryPanel.tsx` (yeni) — sol geçmiş paneli
- Arama kutusu (FTS); sonuçlar oturum + snippet olarak listelenir, tıklayınca
  oturum açılır ve ilgili mesaja kaydırılır.
- “+ Yeni sohbet” düğmesi.
- Oturum satırları: başlık + göreli tarih; **Sabitlenenler / Diğer** grupları;
  aktif vurgu; satır menüsü (sabitle / adlandır / sil) — `ConfirmDialog` ile silme.
- Dar pencerede çekmece; açık/kapalı tercihi `localStorage` `jv-ai-history`.
- DESIGN.md ray dili kullanılır (yeni sözlük icat edilmez).
- Panel AI durumundan **bağımsız** çalışır: AI kapalıyken de oturumlar listelenir,
  görüntülenir, adlandırılır, silinir (kalıcı veri yereldir).

### 6.3 `ChatMessages.tsx` (yeni) — mesaj listesi
- Mevcut balonlar (kullanıcı/asistan) korunur.
- `action:tag` onay kartı korunur.
- Yeni **“Bulunan Kayıtlar”** kartı: sorgu eylemi sonucu kayıtlar; başlık ·
  platform · tarih · `onOpenItem` ile aç.
- “Kasa taranıyor…” durumu (spinner + durum metni).
- Referanslar (chunk) kartları korunur.

## 7. Dışa aktarma

Oturum Markdown `exportSessionMarkdown` ile üretilir; dosya yazımı mevcut
`export_backup` komutu üzerinden yapılır (yol renderer'a uğramaz). Komuta
opsiyonel `filter_name` / `extensions` parametreleri (serde default) eklenir;
mevcut JSON çağrıları değişmez.

## 8. DESIGN.md güncellemesi

Koda başlamadan önce `DESIGN.md`'ye `## Asistan (sohbet) yüzeyi` bölümü eklenir:
geçmiş paneli dili, mesaj balonu, durumlar (taranıyor/akıyor/hata), “Bulunan
Kayıtlar” kartı, dışa aktarma. `PRODUCT.md`'nin dokunulmazları (Türkçe metin,
çevrimdışı, performans bütçesi, erişilebilirlik) korunur.

## 9. Test ve doğrulama

- `migrations.test.ts` genişler: göç 5 taze ve eski kasada uygulanır; chat
  tabloları + FTS mevcut.
- `ai-chat.test.ts` (yeni, saf): `parseAssistantMessage` (tag/query/ikisi/bozuk),
  `buildHistoryWindow` bütçe kırpma, `formatChatMarkdown`.
- `ai-context.test.ts` (yeni, saf): `normalizeVaultQuery` limit kırpma, izinli
  `sort`, sayı/tarih normalizasyonu.
- Bitirmeden: `npm run typecheck && npm run lint && npm run test && npm run build`
  + `cargo check` (Rust dokunuşu).

## 10. Dosya listesi

**Yeni:** `src/lib/db/chat.ts` · `src/lib/ai-context.ts` · `src/lib/ai-chat.ts` ·
`src/components/ChatHistoryPanel.tsx` · `src/components/ChatMessages.tsx` ·
`src/lib/ai-chat.test.ts` · `src/lib/ai-context.test.ts`

**Değişen:** `src/lib/db/migrations.ts` · `src/lib/db/client.ts` ·
`src/lib/ai.ts` · `src/components/AiAssistantView.tsx` ·
`src/lib/db/migrations.test.ts` · `src-tauri/src/settings.rs` · `DESIGN.md`

## 11. Riskler ve önlemler

- **Küçük modelin blok uyumu:** `action:query` JSON'u üretemeyebilir. Önlem:
  savunmacı ayrıştırma (bozuk blok yok sayılır, içerik korunur); prompt net
  örnekle verilir; blok gizlense bile normal yanıt akışı bozulmaz.
- **Gecikme:** iki geçiş ikinci bir model çağrısıdır. Önlem: yalnızca yapısal
  veri gerektiğinde tetiklenir; “Kasa taranıyor…” ile dürüst geri bildirim.
- **Context taşması:** geçmiş + özet + referanslar. Önlem: `buildHistoryWindow`
  karakter bütçesi, kasa özeti tavanı, referans sayısı sabit (5).
- **FTS senkron sapması:** tetikleyici yerine açık senkron. Önlem: ekle/sil her
  ikisini birlikte yazar; silme testi.

## 12. Çıkış kriterleri

- [ ] Göç 5 taze ve eski kasada veri kaybetmeden uygulanır; chat tabloları + FTS var.
- [ ] Sohbet oturumları SQLite'ta kalıcı; uygulama yeniden açılınca liste ve
      mesajlar durur.
- [ ] Oturum oluştur/geç/adlandır/sil/sabitle çalışır; silme FTS'i de temizler.
- [ ] Tüm sohbetlerde tam metin arama oturum + snippet döner, tıklayınca ilgili
      mesaja gidilir.
- [ ] Oturum Markdown olarak dışa aktarılır (yol renderer'a uğramaz).
- [ ] Çok turlu sohbet: önceki mesajlar modele taşınır; bağlam penceresi kırpılır.
- [ ] Yapısal sorgu eylemi: asistan gerektiğinde sorgu üretir, arayüz çalıştırır,
      sonuç referans olarak görünür ve yanıt sonuçlara dayanır.
- [ ] Hafif kasa özeti her prompt'a eklenir; sayım/filtre soruları doğru yanıtlanır.
- [ ] `action:tag` davranışı bozulmadan korunur.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` ve
      `cargo check` yeşil.
- [ ] `DESIGN.md` yeni yüzeyle güncellendi; dokunulmazlar korundu.
