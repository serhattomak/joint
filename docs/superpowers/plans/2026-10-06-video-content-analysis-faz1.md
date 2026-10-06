# Videodan İçerik Analizi — Faz 1 (Metin-only) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** İndirilmiş bir videonun transkriptini (hazır altyazı → gömülü altyazı → yt-dlp altyazısı → whisper large-v3) üretip yerel 14B LLM ile **tarif / konu / anahtar kelime / özet** çıkarmak ve kayıt detayında göstermek.

**Architecture:**
- **Rust ağır işi yapar, DB'ye dokunmaz** (mevcut `transcribe` deseni). Yeni `analyze.rs` tek Tauri komutu `analyze_media` sunar: transkript edinir (katmanlı), LLM çıkarımını çalıştırır, **JSON string** döner + `analyze-progress` event'i yayar. Tek `download::QUEUE` kilidi altında.
- **TS veri/kalıcılık/taksonomi sahibidir** (Rust'ta DB erişimi yok). Yeni `lib/analysis.ts`: idempotency kontrolü, `analyze_media` çağrısı, `taxonomy.ts` ile normalize/uygula, `item_analysis`'e yaz, `refreshItemIndex` ile indeksle.
- **Faz 1 görsel yok.** Şema Faz 2 alanlarını (`visual_notes_json`) rezerve eder.

**Tech Stack:** Tauri v2, Rust, React 19, TypeScript, Vite, `@tauri-apps/plugin-sql`, Vitest, `serde_json`, mevcut `reqwest`.

**Spec:** `docs/superpowers/specs/2026-10-06-video-content-analysis-design.md`

## Global Constraints

- Çevrimdışı/yerel-öncelikli; yeni npm bağımlılığı YOK. Bulut/uzak model çağrısı YOK.
- Çıktı dili Türkçe; kaynak dil algılanır. Arayüz Türkçe.
- Ağır işler mevcut `download::QUEUE` (`tauri::async_runtime::Mutex`, non-reentrant) altında serileşir.
- AI kapalı / model eksikse **fail-closed**: net Türkçe hata, çökme yok.
- Mevcut taksonomi tekrar yazılmaz: `taxonomy.ts` (`resolveCategories`/`resolveTags`) aynen çağrılır.
- UI `DESIGN.md` token/primitifleriyle; yeni görsel dil yok (`settings-card`, mevcut `ui/*`).
- Doğrulama: `npm run typecheck && npm run lint && npm run test && npm run build` (+ `cargo test`, workdir `jointvault/src-tauri`).

## Review Focus

1. **Idempotency** — analizli kayıt varsayılan atlanır; `force` ile üzerine yazılır; `UNIQUE(item_id)`. *(T1 + T6)*
2. **Transkript kaynak sırası** — mevcut `.srt` > gömülü altyazı > yt-dlp altyazısı > whisper; hiçbiri yoksa fail-closed. *(T3 saf test)*
3. **Geçersiz LLM JSON** — çıkarım çökmez, "başarısız" işaretlenir; kısmi sonuç korunur. *(T4 saf test)*
4. **Uzun transkript map-reduce** — tek JSON'a iner, tarif sonda olsa da kaçmaz. *(T4 saf test)*
5. **Taksonomi disiplini** — topic/keyword `taxonomy.ts` ile normalize + eşikli; kategori patlaması yok. *(T6 saf test + manuel)*
6. **Fail-closed** — AI kapalı/model yok → komut hata döner, UI eylemi kilitli. *(T5 + manuel)*

---

## Task 1: `item_analysis` depolama (migration 6 + client + tipler)

**Files:**
- Modify: `jointvault/src/lib/db/schema.sql`
- Modify: `jointvault/src/lib/db/migrations.ts`
- Modify: `jointvault/src/lib/db/types.ts`
- Create: `jointvault/src/lib/db/item_analysis.ts`
- Test: `jointvault/src/lib/db/item_analysis.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type AnalysisStatus = 'pending' | 'running' | 'done' | 'partial' | 'error'`
  - `interface RecipeText { title: string; ingredients: string[]; steps: string[]; notes: string }`
  - `interface ItemAnalysis { id: string; item_id: string; status: AnalysisStatus; contains_recipe: boolean | null; confidence: number | null; language: string | null; summary: string | null; recipe: RecipeText | null; topics: string[]; keywords: string[]; visual_notes: string[] | null; transcript_source: string | null; transcript_path: string | null; model_versions: Record<string, string> | null; error_message: string | null; analyzed_at: string | null; created_at: string; updated_at: string }`
- Produces (`item_analysis.ts`):
  - `getItemAnalysis(itemId: string): Promise<ItemAnalysis | null>`
  - `upsertItemAnalysis(a: Omit<ItemAnalysis, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<void>`
  - `deleteItemAnalysis(itemId: string): Promise<void>`
  - `listItemIdsNeedingAnalysis(): Promise<string[]>` (indirilmiş + analizi olmayan/durumu `error`)
  - `toItemAnalysis(row: ItemAnalysisRow): ItemAnalysis` (saf, test edilir)

- [ ] **Step 1: Başarısız testi yaz** — `item_analysis.test.ts`:

```ts
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
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- item_analysis` (workdir `jointvault`)
Expected: FAIL — modül/tip yok.

- [ ] **Step 3: `schema.sql`'e tabloyu ekle** (id `TEXT` — uygulama UUID PK konvansiyonu; `items.id` TEXT):

```sql
CREATE TABLE IF NOT EXISTS item_analysis (
  id                TEXT PRIMARY KEY,
  item_id           TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending',
  contains_recipe   INTEGER,
  confidence        REAL,
  language          TEXT,
  summary           TEXT,
  recipe_json       TEXT,
  topics_json       TEXT,
  keywords_json     TEXT,
  visual_notes_json TEXT,
  transcript_source TEXT,
  transcript_path   TEXT,
  model_versions_json TEXT,
  error_message     TEXT,
  analyzed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_item_analysis_status ON item_analysis(status);
```

- [ ] **Step 4: `migrations.ts`'e göç 6'yı ekle** (`MIGRATIONS` dizisinin sonuna; en yüksek sürüm 5 → 6):

```ts
{
  version: 6,
  description: 'içerik analizi kayıtları',
  statements: [
    `CREATE TABLE IF NOT EXISTS item_analysis (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      contains_recipe INTEGER,
      confidence REAL,
      language TEXT,
      summary TEXT,
      recipe_json TEXT,
      topics_json TEXT,
      keywords_json TEXT,
      visual_notes_json TEXT,
      transcript_source TEXT,
      transcript_path TEXT,
      model_versions_json TEXT,
      error_message TEXT,
      analyzed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_item_analysis_status ON item_analysis(status)`,
  ],
},
```

- [ ] **Step 5: `types.ts` tiplerini ekle** (yukarıdaki `AnalysisStatus`, `RecipeText`, `ItemAnalysis`).

- [ ] **Step 6: `item_analysis.ts` yaz** — `getDb()`; `db.select`/`db.execute`; `$1` placeholder (mevcut `client.ts` deseni). `upsertItemAnalysis`: `INSERT ... ON CONFLICT(item_id) DO UPDATE SET ... , updated_at = strftime(...)`. `toItemAnalysis` saf dönüşüm (JSON.parse try/catch). `listItemIdsNeedingAnalysis`:
  ```sql
  SELECT i.id FROM items i
  LEFT JOIN item_analysis a ON a.item_id = i.id
  WHERE i.local_path IS NOT NULL AND (a.item_id IS NULL OR a.status = 'error')
  ORDER BY i.updated_at DESC
  ```

- [ ] **Step 7: Testi çalıştır, geçtiğini gör**

Run: `npm test -- item_analysis`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add jointvault/src/lib/db/schema.sql jointvault/src/lib/db/migrations.ts jointvault/src/lib/db/types.ts jointvault/src/lib/db/item_analysis.ts jointvault/src/lib/db/item_analysis.test.ts
git commit -m "feat(db): item_analysis tablosu + migration 6 + client"
```

---

## Task 2: Whisper `large-v3` / `large-v3-q5_0` bileşeni (Türkçe kalite)

**Files:**
- Modify: `jointvault/src-tauri/src/components.rs`
- Modify: `jointvault/src-tauri/src/whisper.rs`
- Modify: `jointvault/src/lib/whisper.ts`
- Modify: `jointvault/src/lib/components.ts`
- Modify: `jointvault/src/components/SettingsView.tsx` (yalnızca model listesi genişlerse)
- Test: `jointvault/src-tauri/src/components.rs` (mevcut `mod tests` içine)

**Interfaces:**
- Consumes: mevcut `Dest::Models`, `Kind::Asset`, `PayloadRule::Raw`, `MIB`, `ASSET_VERSION_ARG`.
- Produces: model id'leri `"large-v3"` ve `"large-v3-q5_0"`; bileşen id'leri `whisper-model-large-v3`, `whisper-model-large-v3-q5_0`.
- `whisper.rs`: `valid_model` ve `whisper_status` yeni id'leri içerir. `model_file_name` zaten `ggml-{model}.bin` üretir → `ggml-large-v3.bin`, `ggml-large-v3-q5_0.bin`.

- [ ] **Step 1: sha256'ları sabitle** — HF API `tree?expand=true` LFS `oid` alanından alındı (indirmeye gerek yok):

| dosya | boyut (bayt) | sha256 |
|---|---|---|
| `ggml-large-v3-q5_0.bin` | `1081140203` | `d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1` |
| `ggml-large-v3.bin` | `3095033483` | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |

Bu değerler Step 2'de sabitlenir.

- [ ] **Step 2: `components.rs` sabitlerini ekle** (line ~332 sonrası, tiny/base/small desenini birebir kopyala):

```rust
const WHISPER_MODEL_LARGE_V3_Q5_FILE: &str = "ggml-large-v3-q5_0.bin";
const WHISPER_MODEL_LARGE_V3_Q5_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin";
const WHISPER_MODEL_LARGE_V3_Q5_SHA256: &str =
    "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1";
const WHISPER_MODEL_LARGE_V3_Q5_BYTES: u64 = 1_081_140_203;
const WHISPER_MODEL_LARGE_V3_Q5_MB: u32 = 1031;

const WHISPER_MODEL_LARGE_V3_FILE: &str = "ggml-large-v3.bin";
const WHISPER_MODEL_LARGE_V3_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin";
const WHISPER_MODEL_LARGE_V3_SHA256: &str =
    "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2";
const WHISPER_MODEL_LARGE_V3_BYTES: u64 = 3_095_033_483;
const WHISPER_MODEL_LARGE_V3_MB: u32 = 2951;
```

- [ ] **Step 3: `SPECS`'e iki `Spec` ekle** (small Spec'inden sonra, ~line 603) — id'ler Step 4 ile eşleşmeli:

```rust
Spec {
    id: "whisper-model-large-v3-q5_0",
    label: "Whisper modeli (large-v3, hızlı)",
    approx_mb: WHISPER_MODEL_LARGE_V3_Q5_MB,
    dest: Dest::Models,
    kind: Kind::Asset,
    downloaded_file: WHISPER_MODEL_LARGE_V3_Q5_FILE,
    sidecar: None,
    version_arg: ASSET_VERSION_ARG,
    download: Some(DownloadSpec {
        bundle: "whisper-model-large-v3-q5_0",
        url: WHISPER_MODEL_LARGE_V3_Q5_URL,
        sha256: WHISPER_MODEL_LARGE_V3_Q5_SHA256,
        expected_bytes: WHISPER_MODEL_LARGE_V3_Q5_BYTES,
        disk_required_bytes: WHISPER_MODEL_LARGE_V3_Q5_BYTES,
        payload: PayloadRule::Raw { file_name: WHISPER_MODEL_LARGE_V3_Q5_FILE },
    }),
    post_install: None,
},
Spec {
    id: "whisper-model-large-v3",
    label: "Whisper modeli (large-v3, yüksek doğruluk)",
    approx_mb: WHISPER_MODEL_LARGE_V3_MB,
    dest: Dest::Models,
    kind: Kind::Asset,
    downloaded_file: WHISPER_MODEL_LARGE_V3_FILE,
    sidecar: None,
    version_arg: ASSET_VERSION_ARG,
    download: Some(DownloadSpec {
        bundle: "whisper-model-large-v3",
        url: WHISPER_MODEL_LARGE_V3_URL,
        sha256: WHISPER_MODEL_LARGE_V3_SHA256,
        expected_bytes: WHISPER_MODEL_LARGE_V3_BYTES,
        disk_required_bytes: WHISPER_MODEL_LARGE_V3_BYTES,
        payload: PayloadRule::Raw { file_name: WHISPER_MODEL_LARGE_V3_FILE },
    }),
    post_install: None,
},
```

- [ ] **Step 4: `missing_message` ve `SPECS` testlerini genişlet** — `components.rs` `missing_message` (line ~966) `whisper-model-large-v3` / `whisper-model-large-v3-q5_0` için Türkçe mesaj; testlerdeki id enumere eden listeleri (KNOWN_IDS/NEW_ASSET_IDS ~1140-1177, `model_specs_download_the_pinned_file_names` ~1645) yeni iki id ile güncelle.

- [ ] **Step 5: `whisper.rs` `valid_model` + `whisper_status`**:

```rust
fn valid_model(model: &str) -> bool {
    matches!(model, "tiny" | "base" | "small" | "large-v3" | "large-v3-q5_0")
}
```
`model_path` hata metnini ve `whisper_status`'ün `models` nesnesini genişlet:
```rust
"models": {
    "tiny": has("tiny"), "base": has("base"), "small": has("small"),
    "large-v3": has("large-v3"), "large-v3-q5_0": has("large-v3-q5_0"),
}
```

- [ ] **Step 6: Frontend model listesi** — `lib/whisper.ts`: `type WhisperModel = 'tiny'|'base'|'small'|'large-v3'|'large-v3-q5_0'`; `WHISPER_MODELS` dizisine `{ id: 'large-v3-q5_0', label: 'large-v3 (hızlı)', mb: 1031 }` ve `{ id: 'large-v3', label: 'large-v3 (yüksek doğruluk)', mb: 2951 }` ekle. `lib/components.ts` bilinen id listesine iki bileşen id'sini ekle. `SettingsView.tsx` `whisper-model-${m.id}` anahtarı otomatik çalışır — kontrol et, gerekirse düzelt.

- [ ] **Step 7: Doğrula**

Run: `cargo test` (workdir `jointvault/src-tauri`) — modeller testleri yeşil.
Run: `npm run typecheck && npm run lint && npm test -- whisper components` (workdir `jointvault`)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add jointvault/src-tauri/src/components.rs jointvault/src-tauri/src/whisper.rs jointvault/src/lib/whisper.ts jointvault/src/lib/components.ts jointvault/src/components/SettingsView.tsx
git commit -m "feat(whisper): large-v3 + large-v3-q5_0 modelleri (Turkce kalite)"
```

---

## Checkpoint: Foundation

- [ ] `cargo test` yeşil; `npm run test` (item_analysis + whisper/components) yeşil.
- [ ] Migration 6 planlanıyor (`planMigrations(5)` → `[6]`).
- [ ] Yeni whisper modelleri Bileşenler listesinde görünür, indirilebilir; `valid_model` kabul eder.
- [ ] İnsan incelemesi: devam etmeden önce onay.

---

## Task 3: `analyze.rs` — transkript edinme (katmanlı, saf karar)

**Files:**
- Modify: `jointvault/src-tauri/src/whisper.rs` (çekirdeği yeniden kullanılabilir yap)
- Modify: `jointvault/src-tauri/src/download.rs` (yalnızca altyazı çekme yardımcısı eklenirse)
- Create: `jointvault/src-tauri/src/analyze.rs`
- Modify: `jointvault/src-tauri/src/lib.rs` (`mod analyze;` — komut kaydı T5'te)

**Interfaces:**
- `whisper.rs` yeniden kullanım: mevcut `transcribe` gövdesini `pub(crate) async fn run_transcribe(app: &AppHandle, input: &str, model: &str, language: &str, job_id: &str) -> Result<TranscriptOut, String>` içine taşı; `#[tauri::command] transcribe` ince sarmalayıcı olur (payload → `run_transcribe`). `TranscriptOut { srt_path: String, language: String }`.
- `analyze.rs`:
  - `pub(crate) enum TranscriptSource { ExistingSrt, Embedded, Captions, Whisper }`
  - `pub(crate) fn choose_transcript_source(has_existing_srt: bool, has_embedded: bool, has_url: bool, whisper_ready: bool) -> Option<TranscriptSource>` (saf, test edilir)
  - `pub(crate) async fn acquire_transcript(app, input_path, url: Option<&str>, language, job_id) -> Result<(TranscriptOut, TranscriptSource), String>`

- [ ] **Step 1: Saf karar fonksiyonunun testini yaz** (`analyze.rs` `mod tests`):

```rust
#[test]
fn source_order_prefers_cheapest_available() {
    use TranscriptSource::*;
    // mevcut srt her şeyi yener
    assert_eq!(choose_transcript_source(true, true, true, true), Some(ExistingSrt));
    // srt yok → gömülü (ffmpeg, çevrimdışı, ucuz)
    assert_eq!(choose_transcript_source(false, true, true, true), Some(Embedded));
    // gömülü yok → yt-dlp altyazısı (ağ)
    assert_eq!(choose_transcript_source(false, false, true, true), Some(Captions));
    // hiçbiri yok → whisper (yerel, ağır)
    assert_eq!(choose_transcript_source(false, false, false, true), Some(Whisper));
    // hiçbir kaynak yok → fail-closed
    assert_eq!(choose_transcript_source(false, false, false, false), None);
}
```

- [ ] **Step 2: Testi çalıştır, başarısız gör** — `cargo test` (workdir `jointvault/src-tauri`). Expected: FAIL.

- [ ] **Step 3: `whisper.rs`'i refactor et** — `run_transcribe` çıkar; `transcribe` komutu aynı imza/davranışı korur (mevcut çağrı `startTranscribe` bozulmaz). `TranscriptOut`'u JSON'a serileştir ama `transcribe`'ın mevcut dönüş şeklini (`{"srt_path","preview","language"}`) **koruyu** (regresyon: `lib/whisper.ts` `isTranscriptData`).

- [ ] **Step 4: `analyze.rs` yaz** — `acquire_transcript`:
  1. `has_existing_srt` = `input_path` yanında `<stem>-transkript.srt` var mı (`transcript_path` kullan).
  2. `has_embedded` = ffprobe/altyazı akışı var mı (mevcut `extract_subtitle` mantığı; hata → yok say).
  3. `has_url` = `url.is_some()`.
  4. `whisper_ready` = seçili model dosyası + motor var mı (`components::spec_for`/`is_installed` deseni).
  5. Seçime göre üret; hepsi best-effort `try`; sıradaki adıma düş. Kaynak bulunamazsa `Err`.
  - yt-dlp altyazısı: `--skip-download --write-subs --write-auto-subs --sub-langs tr,en --convert-subs srt -P <tmp>` + çıktı yolu; yoksa `None`.

- [ ] **Step 5: Testi çalıştır, geçtiğini gör** — `cargo test` PASS.

- [ ] **Step 6: Commit**

```bash
git add jointvault/src-tauri/src/analyze.rs jointvault/src-tauri/src/whisper.rs jointvault/src-tauri/src/download.rs jointvault/src-tauri/src/lib.rs
git commit -m "feat(analyze): katmanli transkript edinme (srt>gomulu>altyazi>whisper)"
```

---

## Task 4: `analyze.rs` — LLM çıkarımı (prompt + şema + map-reduce)

**Files:**
- Modify: `jointvault/src-tauri/src/ai.rs` (yeniden kullanılabilir sohbet tamamlama)
- Modify: `jointvault/src-tauri/src/analyze.rs`
- Test: `jointvault/src-tauri/src/analyze.rs` (`mod tests`)

**Interfaces:**
- `ai.rs`: `pub(crate) async fn chat_completion(app: &AppHandle, system: &str, user: &str, temperature: f32, max_tokens: u32) -> Result<String, String>` (mevcut `ensure_server_running(app,"chat")` + `/v1/chat/completions` deseni; `ai_summarize` bunu kullanacak şekilde sadeleştirilebilir — opsiyonel).
- `analyze.rs`:
  - `#[derive(Serialize, Deserialize, Default, Clone)] pub(crate) struct RecipeText { title: String, ingredients: Vec<String>, steps: Vec<String>, notes: String }`
  - `#[derive(Serialize, Deserialize, Default, Clone)] pub(crate) struct AnalysisOut { contains_recipe: bool, confidence: f32, language: Option<String>, title: Option<String>, summary: String, topics: Vec<String>, keywords: Vec<String>, recipe: Option<RecipeText> }`
  - `pub(crate) fn build_extraction_prompt(title, platform, transcript: &str) -> String`
  - `pub(crate) fn parse_analysis(raw: &str) -> Result<AnalysisOut, String>` (ilk `{` … son `}`; bozuk/eksik → `Err` veya `Default` ile "başarısız" tespiti)
  - `pub(crate) fn is_analysis_empty(a: &AnalysisOut) -> bool`
  - `pub(crate) fn merge_analysis(parts: Vec<AnalysisOut>) -> AnalysisOut`

- [ ] **Step 1: Saf testleri yaz**:

```rust
#[test]
fn parses_valid_json_and_tolerates_missing_fields() {
    let raw = r#"{"contains_recipe":true,"confidence":0.8,"summary":"özet","topics":["Yemek"],"keywords":["kek"],"recipe":{"title":"Kek","ingredients":["un"],"steps":["karıştır"],"notes":""}}"#;
    let a = parse_analysis(raw).unwrap();
    assert!(a.contains_recipe);
    assert_eq!(a.recipe.unwrap().ingredients, vec!["un"]);
}

#[test]
fn invalid_json_is_error_not_panic() {
    assert!(parse_analysis("model bir şeyler saçmaladı").is_err());
    assert!(parse_analysis("{bozuk").is_err());
}

#[test]
fn merge_ors_recipe_maxes_confidence_and_dedups() {
    let a = AnalysisOut { contains_recipe: false, confidence: 0.2, summary: "a".into(), topics: vec!["Yemek".into()], keywords: vec!["kek".into()], ..Default::default() };
    let b = AnalysisOut { contains_recipe: true, confidence: 0.7, summary: "b".into(), topics: vec!["yemek".into(), "Tatlı".into()], keywords: vec!["fırın".into()], ..Default::default() };
    let m = merge_analysis(vec![a, b]);
    assert!(m.contains_recipe);
    assert_eq!(m.confidence, 0.7);
    // Türkçe-duyarsız dedupe: "Yemek"/"yemek" tek kalır
    assert_eq!(m.topics, vec!["Yemek".to_string(), "Tatlı".to_string()]);
    assert!(m.keywords.contains(&"fırın".to_string()));
}

#[test]
fn empty_detection() {
    assert!(is_analysis_empty(&AnalysisOut::default()));
}
```

- [ ] **Step 2: Testi çalıştır, başarısız gör** — `cargo test`. Expected: FAIL.

- [ ] **Step 3: `ai.rs` `chat_completion` ekle** (mevcut `ai_summarize` gövdesinden türet; system+user messages, `temperature`, `max_tokens`, model alanı yok).

- [ ] **Step 4: `analyze.rs` çıkarım fonksiyonlarını yaz** — `build_extraction_prompt` modele **yalnızca JSON** döndürmesini söyler (Türkçe çıktı; `recipe` null olabilir; `ingredients`/`steps` düz metin). `parse_analysis` serde_json + `{...}` kırpma. `merge_analysis` dedupe (küçük harf, `to_lowercase` tr-duyarsız yaklaşımı) + cap (topics ≤ 6, keywords ≤ 12) + `summary` en uzun olan.

- [ ] **Step 5: Testi çalıştır, geçtiğini gör** — `cargo test` PASS.

- [ ] **Step 6: Commit**

```bash
git add jointvault/src-tauri/src/analyze.rs jointvault/src-tauri/src/ai.rs
git commit -m "feat(analyze): LLM cikarim semasi + prompt + map-reduce"
```

---

## Task 5: `analyze_media` komutu (orkestrasyon + ilerleme + fail-closed)

**Files:**
- Modify: `jointvault/src-tauri/src/analyze.rs`
- Modify: `jointvault/src-tauri/src/lib.rs`

**Interfaces:**
- Command: `#[tauri::command] pub async fn analyze_media(app: AppHandle, payload: Value) -> Result<String, String>`
  - payload: `{ item_id: string, input_path: string, url?: string|null, title?: string|null, platform?: string|null, language?: string|null, job_id: string }`
- Event `analyze-progress` → `{ jobId, stage: 'transcript'|'extract', percent }` (mevcut `WhisperProgress`/`emit_whisper_progress` deseni).
- Dönüş: JSON string `{ analysis: AnalysisOut, transcript_source: string, transcript_path: string, model_versions: {...} }`.

- [ ] **Step 1: Komutu yaz**:
  - `let _guard = crate::download::QUEUE.lock().await;`
  - AI kapalı/LLM yok → `Err("Yapay zeka kapalı veya sohbet modeli kurulu değil...")` (fail-closed). Kontrol: `crate::ai::ai_enabled_now` yok ise `ai_status`-benzeri kontrol ya da `ensure_server_running` hatasını yüzeye çıkar.
  - `acquire_transcript` (T3) → `analyze-progress stage=transcript`.
  - Transkripti parçala (word bazlı ~1500 kelime/parça) → her parça `build_extraction_prompt` + `chat_completion` + `parse_analysis` (hata → parça atla).
  - `merge_analysis`; hiç geçerli parça yoksa "başarısız" (`is_analysis_empty` + hata).
  - `analyze-progress stage=extract`.
  - JSON dön.

- [ ] **Step 2: `lib.rs` kaydı** — `mod analyze;` ekle; `generate_handler!` içine `analyze::analyze_media,` ekle.

- [ ] **Step 3: Derle + test**

Run: `cargo test` (workdir `jointvault/src-tauri`); `cargo build`
Expected: PASS.

- [ ] **Step 4: Manuel smoke** — `npx tauri dev`; indirilmiş bir videoda `invoke('analyze_media', { payload: {...} })` ile JSON döndüğünü gör; AI kapalıyken hata döndüğünü doğrula.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src-tauri/src/analyze.rs jointvault/src-tauri/src/lib.rs
git commit -m "feat(analyze): analyze_media komutu + ilerleme + fail-closed"
```

---

## Checkpoint: Core

- [ ] `cargo test` yeşil; `analyze_media` gerçek videoda JSON döner.
- [ ] AI kapalı → net hata, çökme yok.
- [ ] Uzun video (>1 parça) tek JSON'a iner.
- [ ] İnsan incelemesi: devam etmeden önce onay.

---

## Task 6: `lib/analysis.ts` — orkestrasyon + taksonomi + kalıcılık

**Files:**
- Create: `jointvault/src/lib/analysis.ts`
- Test: `jointvault/src/lib/analysis.test.ts`
- Modify: `jointvault/src/lib/db/item_analysis.ts` (gerekirse yardımcı)

**Interfaces:**
- Consumes: `invoke` (`@tauri-apps/api/core`), `listen` (`@tauri-apps/api/event`), `getItem`, `getItemAnalysis`, `upsertItemAnalysis`, `resolveCategories`, `resolveTags`, `applyCategorization`, `refreshItemIndex`, `getAiStatus`/`isAiEnabled`, `listCategories`/`listTags`, `pickWhisperModel` (saf, test edilir).
- Produces:
  - `pickWhisperModel(installed: string[]): string | null` — öncelik `large-v3-q5_0` → `large-v3` → `small` → `base` → `tiny`
  - `interface AnalyzeResult { ok: boolean; error?: string; partial?: boolean }`
  - `analyzeItem(itemId: string, opts?: { force?: boolean }): Promise<AnalyzeResult>`
  - `useAnalyzeProgress(onEvent: (e: AnalyzeProgressEvent) => void): void` (event `'analyze-progress'`)
  - `AnalyzeProgressEvent { jobId: string; stage: 'transcript' | 'extract'; percent: number }`

- [ ] **Step 1: Saf `pickWhisperModel` testini yaz** (`analysis.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { pickWhisperModel } from './analysis';

describe('pickWhisperModel', () => {
  it('öncelik sırası: q5 → large-v3 → small → base → tiny', () => {
    expect(pickWhisperModel(['tiny', 'small', 'large-v3'])).toBe('large-v3');
    expect(pickWhisperModel(['tiny', 'base', 'small'])).toBe('small');
    expect(pickWhisperModel(['tiny'])).toBe('tiny');
    expect(pickWhisperModel([])).toBeNull();
  });
  it('q5_0 varken onu seçer', () => {
    expect(pickWhisperModel(['small', 'large-v3', 'large-v3-q5_0'])).toBe('large-v3-q5_0');
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız gör** — `npm test -- analysis`. Expected: FAIL.

- [ ] **Step 3: `analysis.ts` yaz** — akış:
  1. AI kapalı → `{ ok:false, error:'Yapay zeka kapalı...' }` (`isAiEnabled`).
  2. `force` değil ve `getItemAnalysis(itemId)?.status === 'done'|'partial'` → `{ ok:true }` (atla).
  3. `getItem(itemId)`; `local_path` yok → hata.
  4. `upsertItemAnalysis({ item_id, status:'running' })`.
  5. `invoke('analyze_media', { payload: { item_id, input_path, url, title, platform, language, job_id } })` (job_id = `crypto.randomUUID()`), try/catch.
  6. Başarı: JSON'u çöz; `resolveCategories(topics, cats, { confidence, minConfidence: readTagThreshold(), maxNew: 1 })`, `resolveTags(keywords, tags, { max: 12 })`; `upsertItemAnalysis({..., status:'done', recipe_json, topics_json, keywords_json, ...})`.
  7. `auto_apply_tags` açık ve öneri varsa `applyCategorization(itemId, cats, tags)`.
  8. `refreshItemIndex(itemId)`.
  9. Hata: `status:'error'` + `error_message` yaz; `{ ok:false, error }`.
  10. `partial` = görsel yok (Faz 1'de her zaman metin-only → `partial:false`; Faz 2'de anlamlı).

- [ ] **Step 4: Testi çalıştır, geçtiğini gör** — `npm test -- analysis` PASS.

- [ ] **Step 5: Doğrula** — `npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add jointvault/src/lib/analysis.ts jointvault/src/lib/analysis.test.ts jointvault/src/lib/db/item_analysis.ts
git commit -m "feat(analysis): orkestrasyon + taksonomi + kayit + indeks"
```

---

## Task 7: `ItemRecord` — "İçerik Analizi" bölümü

**Files:**
- Modify: `jointvault/src/components/ItemRecord.tsx`

**Interfaces:**
- Consumes: `analyzeItem`, `useAnalyzeProgress` (`@/lib/analysis`), `getItemAnalysis`, `ItemAnalysis`.

- [ ] **Step 1: Bölümü ekle** — `ItemRecord.tsx` sağ kolon, mevcut "Yapay Zekâ Taksonomi Analizi" (line ~478) **altına** yeni blok (aynı görsel dil: `rounded-lg border border-primary/20 bg-primary/5 p-4` ya da `settings-card`; `DESIGN.md` "kart-içinde-kart yok"):
  - Başlık: **"İçerik Analizi"**.
  - Durum: analiz yok → "Analiz et" butonu; `running` → `ui/progress` + aşama etiketi; `done`/`partial` → içerik; `error` → mesaj + "Yeniden dene".
  - Tarif kartı: `contains_recipe && confidence >= 0.6` iken başlık + malzeme listesi + adım listesi + notlar + kopyala (`Button` variant `ghost`/`link`).
  - Özet + topic/keyword çipleri (`ui/badge` / mevcut etiket çipi).
  - "Yeniden analiz et" (`force:true`) butonu.
- [ ] **Step 2: State + efekt** — `analysis: ItemAnalysis | null`, `analyzing: boolean`, `analyzeProgress`; `item.id` değişince `getItemAnalysis` yükle; `useAnalyzeProgress` aboneliği; buton → `analyzeItem(item.id)`.
- [ ] **Step 3: AI kapalı/kilit** — `isAiEnabled` değilse buton `disabled` + Ayarlar yönlendirme metni (mevcut desen).
- [ ] **Step 4: Doğrula** — `npm run typecheck && npm run lint && npm run build` + manuel smoke (`npx tauri dev`).

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/components/ItemRecord.tsx
git commit -m "feat(ui): kayit detayinda Icerik Analizi bolumu"
```

---

## Task 8: Toplu analiz + ilerleme/iptal

**Files:**
- Modify: `jointvault/src/lib/analysis.ts` (toplu fonksiyon)
- Modify: kayıt listesi görünümü (İndirmeler/Arşiv listesi — mevcut eylem çubuğu)
- Test: `jointvault/src/lib/analysis.test.ts` (saf seçim mantığı)

**Interfaces:**
- Produces: `analyzeMissing(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ processed: number; failed: number; skipped: number }>`
- `listItemIdsNeedingAnalysis` (T1) ile kuyruk; **seri**; `signal` ile iptal (döngü başında `signal.aborted`).

- [ ] **Step 1: Saf testi yaz** — `shouldSkipBySignal(aborted)` ve sayım mantığı için küçük saf fonksiyonlar; `analyzeMissing` birim testi IPC nedeniyle manuel (mevcut konvansiyon).
- [ ] **Step 2: `analyzeMissing` yaz** — sırayla `analyzeItem` çağır; ilerleme "N/M"; iptal sinyalinde dur.
- [ ] **Step 3: UI** — kayıt listesi eylem çubuğuna "Analiz edilmemişleri analiz et" (`Button` variant `outline`); çalışırken `ui/progress` + "N/M" + **İptal** (`AbortController`). İş bitince liste tazele.
- [ ] **Step 4: Doğrula** — `npm run typecheck && npm run lint && npm run build` + manuel smoke.
- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/analysis.ts jointvault/src/lib/analysis.test.ts jointvault/src/components
git commit -m "feat(analysis): toplu analiz + ilerleme + iptal"
```

---

## Checkpoint: Complete

- [ ] Kayıt detayında analiz çalışır, tarif kartı eşikle görünür.
- [ ] Toplu analiz N/M ilerler, iptal edilebilir, idempotent.
- [ ] Taksonomi çoğalması yok; öneriler normalize.
- [ ] İnsan incelemesi: devam etmeden önce onay.

---

## Task 9: Bütünsel doğrulama

- [ ] **Step 1: Tüm kapılar**

Run: `cargo test` (workdir `jointvault/src-tauri`)
Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: yeşil.

- [ ] **Step 2: Manuel smoke (`npx tauri dev`, AI açık)**
- [ ] Türkçe bir videoda transkript kalitesi `small`'a göre belirgin iyileşir.
- [ ] Hazır altyazısı olan videoda whisper çalışmaz (`transcript_source='captions'/'embedded'`).
- [ ] Tarif içeren videoda tarif kartı görünür; içermeyen videoda görünmez ama özet/topic/keyword gelir.
- [ ] Uzun video tek JSON'a iner.
- [ ] AI kapalıyken buton kilitli; açıp çalıştırınca hata yok.
- [ ] Analiz sonucu aramada görünür (`refreshItemIndex` sonrası).

- [ ] **Step 3: DESIGN/PRODUCT tutarlılığı** — yeni görsel kural/token yok; dil Türkçe; offline invariant korunur.

- [ ] **Step 4: Commit (gerekirse) + spec güncellemesi** — spec §6/§4.3/§4.5'te planla uyumlanan düzeltmeler (TEXT id, kalıcılık TS tarafı) zaten yapıldıysa ek iş yok.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| HF'de sha256 yok | Model indirme doğrulaması | İndir + yerelde hesapla + sabitle (T2 Step 1) |
| yt-dlp altyazı çekme ağ/format sorunu | Captions katmanı çalışmaz | best-effort; gömülü/whisper'a düşer |
| 14B model uzun transkriptte bağlam taşması | Eksik çıkarım | map-reduce parça (T4/T5), parça cap |
| Rust DB erişimi yok | Kalıcılık Rust'ta yapılamaz | Kalıcılık/taksonomi TS tarafı (T6) — mevcut `transcribe` deseniyle uyumlu |
| `whisper_status`/`valid_model` başka yerde hard-coded | Eksik model görünür | T2 Step 4-6 tüm enumerasyon noktalarını günceller |

## Open Questions

- yt-dlp altyazıları analiz anında ayrı bir indirme adımı mı, yoksa video indirilirken mi çekilsin? (Plan: analiz anında, best-effort.)
- Analiz metni `item_chunks`'a `chunk_type='analysis'` ile ayrıca yazılsın mı? (Plan: `refreshItemIndex` mevcut transkript chunk'larını tazeler; ayrı tip Faz 1'de yok.)

## Self-Review Notları

- **Spec kapsamı:** §4.1→T2; §4.2→T3; §4.3→T5; §4.4→T4; §4.5→T6; §4.6→T4/T5; §6→T1; §7→T7/T8; §8→T1-T8; §11→T9.
- **Mimari sapma (spec'e göre, gerekçeli):** Rust'ta DB erişimi yok → kalıcılık + taksonomi + indeksleme **TS tarafına** alındı (mevcut `transcribe` deseni). Spec §4.3/§4.5 bu yönde güncellenmeli.
- **Tip tutarlılığı:** Rust `AnalysisOut` alanları ↔ TS `ItemAnalysis` JSON kolonları eşleşir (`recipe`↔`recipe_json` vb.). `item_analysis.id` TEXT (uygulama UUID konvansiyonu).
- **Basitleştirme:** Rust DB/IPC yolları birim test edilmez (pure fonksiyonlar test edilir); gerçek model yolu manuel smoke. Faz 2 (görsel) bu planda yok.
