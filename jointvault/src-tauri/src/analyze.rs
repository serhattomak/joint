// Transkript edinme katmanı — `analyze_media` (T5) için kaynak seçimi + üretim.
//
// Spec §4.2: en ucuz/kapalı kaynak önce. Karar SAF bir fonksiyonda (`choose_transcript_source`)
// tutulur; yan etkiler (ffmpeg/yt-dlp/whisper çalıştırma) `acquire_transcript` içinde kalır.
// Böylece sıralama tek başına test edilebilir, üretim kodu karara karışmaz.
//
// Kuyruk kilidi (`download::QUEUE`) BURADA ALINMAZ: çağıran komut (T5) alır; yeniden-girilemez
// mutex içeriden alınırsa kilitlenirdi.

use crate::whisper::{self, TranscriptOut};
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
}
