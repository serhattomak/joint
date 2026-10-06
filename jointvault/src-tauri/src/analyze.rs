// Transkript edinme katmanı — `analyze_media` (T5) için kaynak seçimi + üretim.
//
// Spec §4.2: en ucuz/kapalı kaynak önce. Karar SAF bir fonksiyonda (`choose_transcript_source`)
// tutulur; yan etkiler (ffmpeg/yt-dlp/whisper çalıştırma) `acquire_transcript` içinde kalır.
// Böylece sıralama tek başına test edilebilir, üretim kodu karara karışmaz.
//
// Kuyruk kilidi (`download::QUEUE`) BURADA ALINMAZ: çağıran komut (T5) alır; yeniden-girilemez
// mutex içeriden alınırsa kilitlenirdi.

use crate::whisper::{self, TranscriptOut};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// Transkriptin elde edildiği katman. Sıralama ucuzdan pahalıya doğrudur ve
/// `choose_transcript_source` bunu sabitler.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum TranscriptSource {
    /// Kaynağın yanında hazır `<stem>-transkript.srt` (bedava).
    ExistingSrt,
    /// Videoya gömülü altyazı akışı (ffmpeg, çevrimdışı).
    Embedded,
    /// yt-dlp ile çekilen hazır/otomatik altyazı (ağ).
    Captions,
    /// Yerel whisper ASR (ağır, CPU).
    Whisper,
}

/// Saf karar: mevcut kaynaklardan en ucuzunu seç. Hiçbiri yoksa `None` (fail-closed).
pub(crate) fn choose_transcript_source(
    has_existing_srt: bool,
    has_embedded: bool,
    has_url: bool,
    whisper_ready: bool,
) -> Option<TranscriptSource> {
    if has_existing_srt {
        Some(TranscriptSource::ExistingSrt)
    } else if has_embedded {
        Some(TranscriptSource::Embedded)
    } else if has_url {
        Some(TranscriptSource::Captions)
    } else if whisper_ready {
        Some(TranscriptSource::Whisper)
    } else {
        None
    }
}

/// Arayüzden "auto"/"tr"/"en" dışında bir değer gelirse whisper'a "auto" ver.
/// Whisper adımı geçersiz dilde hata verirdi; burada tek yerde normalize edilir.
fn normalize_language(language: &str) -> &str {
    match language {
        "tr" | "en" => language,
        _ => "auto",
    }
}

/// Katmanlı transkript edinme. Seçilen katmandan başlar; o katman üretemezse
/// (best-effort) sıradaki uygun katmana düşer. Hiçbir kaynak yoksa ya da tüm
/// uygun katmanlar başarısız olursa `Err`.
pub(crate) async fn acquire_transcript(
    app: &AppHandle,
    input_path: &str,
    url: Option<&str>,
    language: &str,
    job_id: &str,
) -> Result<(TranscriptOut, TranscriptSource), String> {
    let language = normalize_language(language);
    let existing_srt = whisper::transcript_path(input_path);
    let has_existing_srt = std::path::Path::new(&existing_srt).is_file();
    let has_url = url.map(|u| !u.trim().is_empty()).unwrap_or(false);

    // Gömülü altyazı: yalnız daha ucuz bir hazır SRT yoksa denir (boşa ffmpeg koşmasın).
    // Çıkarma başarılıysa geçici dosya saklanır ve seçilirse yeniden çıkarılmaz.
    let embedded_tmp = if has_existing_srt {
        None
    } else {
        let tmp = std::env::temp_dir().join(format!("jv-analyze-{job_id}-sub.srt"));
        let tmp_str = tmp.to_string_lossy().to_string();
        match whisper::run_extract_subtitle(app, input_path, &tmp_str, 0, job_id).await {
            Ok(()) => Some(tmp),
            Err(_) => {
                let _ = std::fs::remove_file(&tmp);
                None
            }
        }
    };
    let has_embedded = embedded_tmp.is_some();

    // whisper hazır mı: motor + en az bir model (öncelik sırası `whisper`).
    let whisper_model = whisper::pick_whisper_model(app);
    let whisper_ready =
        whisper_model.is_some() && crate::components::is_installed(app, "whisper");

    let source = choose_transcript_source(has_existing_srt, has_embedded, has_url, whisper_ready)
        .ok_or_else(|| {
            "Uygun transkript kaynağı yok: hazır altyazı bulunamadı ve Whisper kurulu değil."
                .to_string()
        })?;

    // 1) Hazır SRT.
    if source == TranscriptSource::ExistingSrt {
        return Ok((
            TranscriptOut {
                srt_path: existing_srt,
                language: language.to_string(),
            },
            TranscriptSource::ExistingSrt,
        ));
    }

    // 2) Gömülü altyazı (çıkarma başarılıysa geçici dosya çoktan hazır).
    if source == TranscriptSource::Embedded {
        if let Some(tmp) = embedded_tmp {
            let out = whisper::transcript_path(input_path);
            std::fs::copy(&tmp, &out)
                .map_err(|e| format!("Altyazı dosyası yazılamadı: {e}"))?;
            let _ = std::fs::remove_file(&tmp);
            return Ok((
                TranscriptOut {
                    srt_path: out,
                    language: language.to_string(),
                },
                TranscriptSource::Embedded,
            ));
        }
    }

    // 3) yt-dlp altyazısı (yalnız URL varsa ve seçim bu katmanı geçmediyse).
    if has_url && source != TranscriptSource::Whisper {
        // `has_url` true olduğundan url.unwrap() güvenli.
        if let Some(u) = url {
            if let Ok(Some(tmp)) = crate::download::fetch_captions(app, u, "tr,en", job_id).await {
                let out = whisper::transcript_path(input_path);
                std::fs::copy(&tmp, &out)
                    .map_err(|e| format!("Altyazı dosyası yazılamadı: {e}"))?;
                let _ = std::fs::remove_file(&tmp);
                return Ok((
                    TranscriptOut {
                        srt_path: out,
                        language: language.to_string(),
                    },
                    TranscriptSource::Captions,
                ));
            }
        }
    }

    // 4) Whisper ASR (son çare, ağır).
    if let Some(model) = whisper_model {
        let out = whisper::run_transcribe(app, input_path, model, language, job_id).await?;
        return Ok((out, TranscriptSource::Whisper));
    }

    Err("Transkript üretilemedi: kullanılabilir altyazı ya da Whisper modeli yok.".to_string())
}

// ---- LLM çıkarımı (T4): şema + prompt + ayrıştırma + map-reduce birleştirme ----
//
// Tümü SAF (yan etkisiz) fonksiyonlardır: ağ/uygulama durumuna dokunmazlar, bu
// yüzden tek başına test edilebilirler. HTTP çağrısı `ai::chat_completion`'da.

/// Modelin dizi beklediğimiz alanları bazen TEK bir string olarak döndürmesi
/// gerçek bir durumdur (Qwen2.5-14B: `"ingredients": "un, şeker"`). `#[serde(default)]`
/// yalnızca EKSİK alanı kurtarır, yanlış TİPİ kurtarmaz; bu yüzden dizi ve string
/// ikisini de kabul eden bir çözücü kullanırız.
fn string_or_vec<'de, D>(de: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        Many(Vec<String>),
        One(String),
    }
    Ok(match OneOrMany::deserialize(de)? {
        OneOrMany::Many(xs) => xs
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        OneOrMany::One(s) => split_loose(&s),
    })
}

/// `string_or_vec` için gevşek bölme: satır, noktalı virgül ve virgül.
/// `ponytail:` nokta ile cümle bölme YOK; adımlar tek öğede kalabilir, gerekirse
/// buraya nokta+boşluk kuralı eklenir.
fn split_loose(s: &str) -> Vec<String> {
    s.split(|c| matches!(c, '\n' | '\r' | ';' | ','))
        .map(|seg| {
            seg.trim()
                .trim_matches(|c| c == '-' || c == '•' || c == '*')
                .trim()
                .to_string()
        })
        .filter(|seg| !seg.is_empty())
        .collect()
}

/// Modelin döndürdüğü tarif gövdesi. Alanlar `#[serde(default)]` ile eksik
/// gelebilir (model bazı alanları atlarsa ayrıştırma patlamaz).
#[derive(Serialize, Deserialize, Default, Clone)]
pub(crate) struct RecipeText {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default, deserialize_with = "string_or_vec")]
    pub(crate) ingredients: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    pub(crate) steps: Vec<String>,
    #[serde(default)]
    pub(crate) notes: String,
}

/// Tek bir LLM çağrısının (ya da map-reduce birleşiminin) çıktısı. Eksik alanlar
/// `#[serde(default)]` sayesinde varsayılana düşer; `recipe` null olabilir.
#[derive(Serialize, Deserialize, Default, Clone)]
pub(crate) struct AnalysisOut {
    #[serde(default)]
    pub(crate) contains_recipe: bool,
    #[serde(default)]
    pub(crate) confidence: f32,
    #[serde(default)]
    pub(crate) language: Option<String>,
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default)]
    pub(crate) summary: String,
    #[serde(default, deserialize_with = "string_or_vec")]
    pub(crate) topics: Vec<String>,
    #[serde(default, deserialize_with = "string_or_vec")]
    pub(crate) keywords: Vec<String>,
    #[serde(default)]
    pub(crate) recipe: Option<RecipeText>,
}

/// Modele yalnızca JSON döndürmesini söyleyen Türkçe çıkarım prompt'u. Transkript
/// parçası (map-reduce'ta her parça) doğrudan gömülür; üst katman dilimler.
pub(crate) fn build_extraction_prompt(title: &str, platform: &str, transcript: &str) -> String {
    format!(
        "Aşağıdaki video transkriptini analiz et ve içeriği Türkçe olarak çıkar.\n\n\
         Yanıt olarak SADECE geçerli bir JSON nesnesi döndür; markdown, kod bloğu, \
         karşılama veya açıklama EKLEME.\n\n\
         ŞEMA:\n\
         {{\
         \"contains_recipe\": true|false,\
         \"confidence\": 0.0-1.0,\
         \"language\": \"içeriğin dili (örn. tr, en)\",\
         \"title\": \"içerik için kısa Türkçe başlık\",\
         \"summary\": \"2-4 cümlelik Türkçe özet\",\
         \"topics\": [\"en fazla 6 konu\"],\
         \"keywords\": [\"en fazla 12 anahtar kelime\"],\
         \"recipe\": null veya {{\"title\": \"tarif adı\", \"ingredients\": [\"malzeme\"], \"steps\": [\"adım\"], \"notes\": \"notlar\"}}\
         }}\n\n\
         KURALLAR:\n\
         - Tüm metin alanları Türkçe olmalı.\n\
         - İçerik tarif değilse \"recipe\": null bırak ve contains_recipe=false yap.\n\
         - ingredients ve steps bir JSON DİZİSİ olmalı; her öğe tek bir dizge. Köşeli parantez kullan, tek bir uzun string YAZMA.\n\
         - Yalnızca JSON döndür.\n\n\
         Video başlığı: {title}\n\
         Platform: {platform}\n\n\
         TRANSKRİPT:\n{transcript}"
    )
}

/// LLM yanıtından JSON'u ayıkla: ilk `{` ile son `}` arasını al, serde ile çöz.
/// Bozuk/eksik/JSON'suz metin `Err` döner (asla panik yok).
pub(crate) fn parse_analysis(raw: &str) -> Result<AnalysisOut, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| "Yanıtta JSON bulunamadı.".to_string())?;
    let end = raw
        .rfind('}')
        .ok_or_else(|| "Yanıtta JSON bulunamadı.".to_string())?;
    if end < start {
        return Err("Yanıtta geçerli JSON bulunamadı.".to_string());
    }
    serde_json::from_str(&raw[start..=end]).map_err(|e| format!("JSON ayrıştırılamadı: {e}"))
}

/// İçerik barındırmayan (boş) analiz mi? Boş parçalar birleştirmeye sokulmaz.
pub(crate) fn is_analysis_empty(a: &AnalysisOut) -> bool {
    a.summary.trim().is_empty()
        && a.topics.is_empty()
        && a.keywords.is_empty()
        && a.recipe.is_none()
        && a.title.as_deref().map(str::trim).unwrap_or("").is_empty()
}

/// Sıra korunarak, büyük/küçük harf duyarsız tekilleştirme + üst sınır. İlk
/// görülen yazım korunur. `ponytail:` `to_lowercase()` (Rust) Türkçe 'İ'→"i̇"
/// (i + birleşik nokta) üretir; testteki "Yemek"/"yemek" gibi yaygın durumlar
/// için yeterli — tam Türkçe katlama gerekirse buraya harita eklenir.
fn dedupe_cap(items: impl Iterator<Item = String>, cap: usize) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for it in items {
        let t = it.trim();
        if t.is_empty() || !seen.insert(t.to_lowercase()) {
            continue;
        }
        out.push(t.to_string());
        if out.len() >= cap {
            break;
        }
    }
    out
}

/// Map-reduce birleştirme: parça çıktıları tek bir `AnalysisOut`'a indir.
/// - `contains_recipe`: VEYA
/// - `confidence`: en büyük
/// - `language`/`title`: ilk boş olmayan
/// - `summary`: en uzun (karakter sayısı)
/// - `topics`/`keywords`: harf duyarsız tekilleştir, sıra koru, cap (6/12)
/// - `recipe`: ilk `Some` korunur (`ponytail:` basitlik; en güvenli tarifi
///   seçmek gerekirse parçaların confidence'ına göre ayıklanır)
pub(crate) fn merge_analysis(parts: Vec<AnalysisOut>) -> AnalysisOut {
    let mut out = AnalysisOut::default();
    for p in parts {
        out.contains_recipe |= p.contains_recipe;
        out.confidence = out.confidence.max(p.confidence);
        if out.language.is_none() {
            out.language = p.language.filter(|s| !s.trim().is_empty());
        }
        if out.title.is_none() {
            out.title = p.title.filter(|s| !s.trim().is_empty());
        }
        if p.summary.chars().count() > out.summary.chars().count() {
            out.summary = p.summary;
        }
        out.topics.extend(p.topics);
        out.keywords.extend(p.keywords);
        if out.recipe.is_none() {
            out.recipe = p.recipe;
        }
    }
    out.topics = dedupe_cap(out.topics.into_iter(), 6);
    out.keywords = dedupe_cap(out.keywords.into_iter(), 12);
    out
}

// ---- Orkestrasyon (T5): `analyze_media` komutu ----
//
// Tek ağır iş noktasıdır: kuyruk kilidi (`download::QUEUE`) BURADA, en üstte ve
// tam olarak BİR kez alınır; `acquire_transcript`/`chat_completion` içeriden
// ALMAZ (yeniden-girilemez mutex → kilitlenme).

/// Parça başına hedef kelime sayısı. ~1500, modele sığan ve tek çağrıda anlamlı
/// özet çıkaran aralıktır; uzun transkriptler bu boyutta dilimlenir.
const TRANSCRIPT_CHUNK_WORDS: usize = 1500;

/// Çıkarım sistem istemi: modelin SADECE istenen JSON şemasında yanıt vermesini
/// sağlar; şemayı `build_extraction_prompt` taşır.
const EXTRACT_SYSTEM: &str =
    "Sen video transkriptlerinden yapılandırılmış içerik çıkaran bir asistansın. \
     Yalnızca istenen JSON şemasında yanıt verirsin; açıklama veya markdown eklemezsin.";

/// `analyze-progress` olay gövdesi: `{ jobId, stage, percent }` (T6 sözleşmesi).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeProgress {
    job_id: String,
    stage: &'static str,
    percent: f64,
}

fn emit_analyze_progress(app: &AppHandle, job_id: &str, stage: &'static str, percent: f64) {
    let _ = app.emit(
        "analyze-progress",
        AnalyzeProgress {
            job_id: job_id.to_string(),
            stage,
            percent,
        },
    );
}

fn get_str(payload: &Value, key: &str) -> Result<String, String> {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Eksik zorunlu parametre: {key}"))
}

/// `TranscriptSource` → TS sözleşmesindeki kararlı string (T5/T6 arası).
fn transcript_source_str(s: TranscriptSource) -> &'static str {
    match s {
        TranscriptSource::ExistingSrt => "existing_srt",
        TranscriptSource::Embedded => "embedded",
        TranscriptSource::Captions => "captions",
        TranscriptSource::Whisper => "whisper",
    }
}

/// SRT gövdesini düz transkript metnine indir (SAF).
///
/// Zaman damgası (`-->`) ve cue sıra numarası satırları atılır; kalan cue
/// satırları `\n` ile KORUNUR (paragraf sınırı alt katmanda bölme tercihine
/// yarar). Cue içi çok satır boşlukla birleşir.
/// `ponytail:` salt-sayı satır cue İÇERİĞİ ise de atılır (nadir; LLM için zararsız);
/// gerekirse "sonraki satır `-->` içeriyorsa at" kuralına sıkılaştırılır.
fn srt_to_text(srt: &str) -> String {
    let mut out = String::new();
    for line in srt.lines() {
        let t = line.trim();
        if t.is_empty() || t.contains("-->") || t.parse::<u32>().is_ok() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(t);
    }
    out
}

/// Transkripti ~`max_words` kelimelik parçalara böl (SAF, panik yok).
///
/// Paragraf (satır) sınırı önceliklidir; tek başına sınırı aşan dev paragraf
/// kelime akışıyla kırpılır ki HİÇBİR parça `max_words`'ü aşmasın (model
/// bağlamını taşırmamak için). `max_words == 0` veya boş metin → boş vektör.
fn chunk_transcript(text: &str, max_words: usize) -> Vec<String> {
    if max_words == 0 {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut cur = String::new();
    let mut cur_words = 0usize;
    for para in text.split('\n') {
        let p = para.trim();
        if p.is_empty() {
            continue;
        }
        if cur_words > 0 && cur_words + p.split_whitespace().count() > max_words {
            chunks.push(std::mem::take(&mut cur));
            cur_words = 0;
        }
        for w in p.split_whitespace() {
            if cur_words == max_words {
                chunks.push(std::mem::take(&mut cur));
                cur_words = 0;
            }
            if !cur.is_empty() {
                cur.push(' ');
            }
            cur.push_str(w);
            cur_words += 1;
        }
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

/// Tek video için transkript edin → parçala → LLM ile çıkar → birleştir.
///
/// Fail-closed: AI kapalı veya sohbet modeli yoksa pahalı whisper adımından
/// ÖNCE `Err` döner. Kilit: `QUEUE` yalnız burada, tam bir kez alınır.
#[tauri::command]
pub async fn analyze_media(app: AppHandle, payload: Value) -> Result<String, String> {
    // Zorunlu alanlar (varlık doğrulaması; `item_id` yalnız köken bilgisidir).
    get_str(&payload, "item_id")?;
    let input_path = get_str(&payload, "input_path")?;
    let job_id = get_str(&payload, "job_id")?;
    let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let platform = payload
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let language = payload
        .get("language")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("auto");

    // Aşama zamanlaması (tanı): sürenin nereye gittiğini ölçmek için.
    let t_start = std::time::Instant::now();

    // 1) FAIL-CLOSED: pahalı işten önce AI hazır mı? (sunucu yoksa/ kapalıysa Err)
    crate::ai::ensure_chat_ready(&app).await?;
    let ms_ready = t_start.elapsed().as_millis();

    // 2) Tek ağır iş: kuyruk kilidi burada ve YALNIZCA burada alınır.
    let _guard = crate::download::QUEUE.lock().await;

    // 3) Transkript edin (en ucuz kaynaktan başlayan katmanlı üretim).
    emit_analyze_progress(&app, &job_id, "transcript", 0.0);
    let t_transcript = std::time::Instant::now();
    let (t, source) =
        acquire_transcript(&app, &input_path, url.as_deref(), language, &job_id).await?;
    let ms_transcript = t_transcript.elapsed().as_millis();
    emit_analyze_progress(&app, &job_id, "transcript", 100.0);

    // 4) SRT → düz metin → parçalar.
    let srt =
        std::fs::read_to_string(&t.srt_path).map_err(|e| format!("Altyazı okunamadı: {e}"))?;
    let chunks = chunk_transcript(&srt_to_text(&srt), TRANSCRIPT_CHUNK_WORDS);
    if chunks.is_empty() {
        return Err("Transkript boş; analiz edilecek içerik bulunamadı.".to_string());
    }

    // 5) Map: her parça için bir çıkarım çağrısı. `Ok("")`, `Err` veya boş analiz
    //    → parçayı atla (tek bozuk parça tüm işi düşürmez).
    let total = chunks.len();
    let t_extract = std::time::Instant::now();
    let mut parts: Vec<AnalysisOut> = Vec::new();
    // Son hata, tanı için saklanır: genel "içerik döndürmedi" mesajı yerine
    // gerçek sebep (boş yanıt / ayrıştırma hatası) yüzeye çıkar.
    let mut last_err: Option<String> = None;
    for (i, chunk) in chunks.iter().enumerate() {
        emit_analyze_progress(&app, &job_id, "extract", (i as f64 / total as f64) * 100.0);
        let prompt = build_extraction_prompt(title, platform, chunk);
        match crate::ai::chat_completion(&app, EXTRACT_SYSTEM, &prompt, 0.2, 2048).await {
            Ok(raw) if !raw.trim().is_empty() => match parse_analysis(&raw) {
                Ok(a) if !is_analysis_empty(&a) => parts.push(a),
                Ok(_) => last_err = Some("model boş bir analiz döndürdü".to_string()),
                Err(e) => {
                    // Tanı: modelin ham yanıtının başı (JSON'a neden çevrilemediği görünsün).
                    let head: String =
                        raw.chars().take(300).collect::<String>().replace('\n', " ");
                    eprintln!("[analyze] parse hatası: {e} | ham: {head}");
                    last_err = Some(format!("{e} | ham yanıt: {head}"));
                }
            },
            Ok(_) => last_err = Some("model boş yanıt döndürdü".to_string()),
            Err(e) => last_err = Some(e),
        }
    }
    let ms_extract = t_extract.elapsed().as_millis();
    emit_analyze_progress(&app, &job_id, "extract", 100.0);

    // 6) Reduce. Hiç geçerli parça yoksa veya birleşim boşsa → Err (sessiz boş YOK).
    if parts.is_empty() {
        return Err(match last_err {
            Some(e) => format!("Analiz üretilemedi: {e}"),
            None => "Analiz üretilemedi: model geçerli içerik döndürmedi.".to_string(),
        });
    }
    let merged = merge_analysis(parts);
    if is_analysis_empty(&merged) {
        return Err("Analiz boş döndü; geçerli içerik çıkarılamadı.".to_string());
    }

    // 7) model_versions: kayıttan (tek kaynak); sabit dosya adı kopyası YOK.
    let llm = crate::components::spec_for("ai-model-llm")
        .map(|s| s.downloaded_file)
        .unwrap_or("bilinmiyor");
    let whisper_model = whisper::pick_whisper_model(&app).unwrap_or("yok");

    let ms_total = t_start.elapsed().as_millis();
    eprintln!(
        "[analyze] chat_ready={ms_ready}ms transcript={ms_transcript}ms extract={ms_extract}ms total={ms_total}ms src={} chunks={total}",
        transcript_source_str(source)
    );

    Ok(serde_json::json!({
        "analysis": merged,
        "transcript_source": transcript_source_str(source),
        "transcript_path": t.srt_path,
        "model_versions": { "llm": llm, "whisper": whisper_model },
        "timings_ms": {
            "chat_ready": ms_ready,
            "transcript": ms_transcript,
            "extract": ms_extract,
            "total": ms_total,
        },
    })
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn srt_to_text_strips_indices_and_timestamps() {
        let srt = "1\n00:00:00,000 --> 00:00:02,000\nMerhaba dünya\n\n\
                   2\n00:00:02,000 --> 00:00:04,000\nİkinci satır\n";
        assert_eq!(srt_to_text(srt), "Merhaba dünya\nİkinci satır");
        // Boş/çöp girdi panik değil, boş metin.
        assert_eq!(srt_to_text("   \n\n"), "");
    }

    #[test]
    fn chunk_transcript_respects_paragraphs_and_word_budget() {
        // Paragraf sınırı öncelikli: sınırı aşacaksa yeni paragrafta kır.
        assert_eq!(
            chunk_transcript("a b c\nd e f\ng h i", 4),
            vec!["a b c", "d e f", "g h i"]
        );
        // Dev paragraf kelime akışıyla kırpılır; hiçbir parça sınırı aşmaz.
        let big = chunk_transcript("1 2 3 4 5 6 7", 3);
        assert_eq!(big, vec!["1 2 3", "4 5 6", "7"]);
        assert!(big.iter().all(|c| c.split_whitespace().count() <= 3));
        // Boş girdi ve sıfır sınır → boş vektör (panik yok).
        assert!(chunk_transcript("   \n\n", 4).is_empty());
        assert!(chunk_transcript("x", 0).is_empty());
    }

    #[test]
    fn transcript_source_strings_are_stable() {
        use TranscriptSource::*;
        assert_eq!(transcript_source_str(ExistingSrt), "existing_srt");
        assert_eq!(transcript_source_str(Embedded), "embedded");
        assert_eq!(transcript_source_str(Captions), "captions");
        assert_eq!(transcript_source_str(Whisper), "whisper");
    }

    #[test]
    fn parses_string_typed_recipe_lists() {
        // Gerçek Qwen2.5-14B çıktısı: ingredients/steps dizi yerine TEK string.
        let raw = r#"{"contains_recipe":true,"confidence":1.0,"language":"tr","title":"Islak Kek","summary":"Video ıslak kek yapımını anlatır.","topics":["Kek Tarifi","Tatlı"],"keywords":["ıslak kek","fırın"],"recipe":{"title":"Islak Kek","ingredients":"Üç yumurta, bir su bardağı şeker, bir su bardağı süt","steps":"Yumurtaları çırp, sütü ekle, fırında pişir","notes":"Dinlendir."}}"#;
        let a = parse_analysis(raw).unwrap();
        assert!(!is_analysis_empty(&a));
        let r = a.recipe.expect("tarif gelmeli");
        assert!(r.ingredients.len() >= 3, "ingredients bölünmeli: {:?}", r.ingredients);
        assert!(r.steps.len() >= 3, "steps bölünmeli: {:?}", r.steps);
        // Dizi hali de çalışmaya devam eder (regresyon).
        let arr = r#"{"topics":["A","B"],"keywords":["x"],"recipe":{"ingredients":["un"],"steps":["kar"]}}"#;
        assert_eq!(parse_analysis(arr).unwrap().topics, vec!["A", "B"]);
    }
}
