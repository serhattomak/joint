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
use tauri::AppHandle;

/// Transkriptin elde edildiği katman. Sıralama ucuzdan pahalıya doğrudur ve
/// `choose_transcript_source` bunu sabitler.
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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
#[allow(dead_code)] // T5 bağlayana kadar; sıralama testle kilitli
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
#[allow(dead_code)] // T5 bağlayana kadar
fn normalize_language(language: &str) -> &str {
    match language {
        "tr" | "en" => language,
        _ => "auto",
    }
}

/// Katmanlı transkript edinme. Seçilen katmandan başlar; o katman üretemezse
/// (best-effort) sıradaki uygun katmana düşer. Hiçbir kaynak yoksa ya da tüm
/// uygun katmanlar başarısız olursa `Err`.
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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

/// Modelin döndürdüğü tarif gövdesi. Alanlar `#[serde(default)]` ile eksik
/// gelebilir (model bazı alanları atlarsa ayrıştırma patlamaz).
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
#[derive(Serialize, Deserialize, Default, Clone)]
pub(crate) struct RecipeText {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) ingredients: Vec<String>,
    #[serde(default)]
    pub(crate) steps: Vec<String>,
    #[serde(default)]
    pub(crate) notes: String,
}

/// Tek bir LLM çağrısının (ya da map-reduce birleşiminin) çıktısı. Eksik alanlar
/// `#[serde(default)]` sayesinde varsayılana düşer; `recipe` null olabilir.
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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
    #[serde(default)]
    pub(crate) topics: Vec<String>,
    #[serde(default)]
    pub(crate) keywords: Vec<String>,
    #[serde(default)]
    pub(crate) recipe: Option<RecipeText>,
}

/// Modele yalnızca JSON döndürmesini söyleyen Türkçe çıkarım prompt'u. Transkript
/// parçası (map-reduce'ta her parça) doğrudan gömülür; üst katman dilimler.
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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
         - ingredients ve steps düz metin olmalı (madde işareti/numara koyma).\n\
         - Yalnızca JSON döndür.\n\n\
         Video başlığı: {title}\n\
         Platform: {platform}\n\n\
         TRANSKRİPT:\n{transcript}"
    )
}

/// LLM yanıtından JSON'u ayıkla: ilk `{` ile son `}` arasını al, serde ile çöz.
/// Bozuk/eksik/JSON'suz metin `Err` döner (asla panik yok).
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
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
}
