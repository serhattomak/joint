// Ses/video (ffmpeg) ve görsel (image) dönüşümleri.
//
// ffmpeg argümanları TEK yerde kurulur; her hedef için codec/filter tablosu
// burada okunur. Kabuk dizesi yoktur: argümanlar dizi olarak verilir.
use super::{JobCtx, CANCELLED};
use image::{DynamicImage, ImageFormat, RgbImage};
use serde_json::Value;
use std::path::Path;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub(crate) async fn convert_media(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
    target: &str,
    options: &Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    let ffmpeg = crate::components::require_tool(ctx.app, "ffmpeg")?;
    let quality = super::opt_str(options, "quality").unwrap_or("balanced");
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-nostdin".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
    ];

    let start = parse_time(super::opt_str(options, "trim_start"));
    let end = parse_time(super::opt_str(options, "trim_end"));
    if let (Some(start), Some(end)) = (start, end) {
        if start >= end {
            return Err("Kırpma aralığı geçersiz: başlangıç bitişten küçük olmalı.".to_string());
        }
    }
    if let Some(start) = start {
        args.push("-ss".to_string());
        args.push(format!("{start:.3}"));
    }
    args.push("-i".to_string());
    args.push(input.to_string_lossy().to_string());
    if let Some(end) = end {
        if let Some(start) = start {
            args.push("-t".to_string());
            args.push(format!("{:.3}", end - start));
        } else {
            args.push("-to".to_string());
            args.push(format!("{end:.3}"));
        }
    }

    let audio_only = matches!(
        target,
        "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus"
    );
    if audio_only {
        audio_args(&mut args, target, options);
    } else if target == "gif" {
        gif_args(&mut args, options);
    } else {
        video_args(&mut args, target, quality, options);
    }

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push("-nostats".to_string());
    args.push(output.to_string_lossy().to_string());

    let total_ms = crate::convert::probe_duration_ms(ctx.app, &input.to_string_lossy()).await;
    ctx.emit(0.0, "hazırlanıyor");

    let (mut rx, child) = ctx
        .app
        .shell()
        .command(ffmpeg.to_string_lossy().to_string())
        .args(args)
        .spawn()
        .map_err(|e| format!("ffmpeg başlatılamadı: {e}"))?;
    ctx.register_child(child);

    let mut last_err = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                for part in text.split(['\n', '\r']) {
                    if let Some(value) = part.strip_prefix("out_time_us=") {
                        if let (Some(total), Ok(us)) = (total_ms, value.trim().parse::<u64>()) {
                            let percent = (us as f64 / 1000.0 / total as f64 * 100.0).clamp(0.0, 99.0);
                            ctx.emit(percent, "dönüştürülüyor");
                        }
                    } else if let Some(value) = part.strip_prefix("out_time_ms=") {
                        if let (Some(total), Ok(ms)) = (total_ms, value.trim().parse::<u64>()) {
                            let percent = (ms as f64 / total as f64 * 100.0).clamp(0.0, 99.0);
                            ctx.emit(percent, "dönüştürülüyor");
                        }
                    }
                }
            }
            CommandEvent::Stderr(line) => {
                crate::convert::push_capped(&mut last_err, &String::from_utf8_lossy(&line));
                last_err.push('\n');
            }
            CommandEvent::Error(error) => crate::convert::push_capped(&mut last_err, &error),
            CommandEvent::Terminated(payload) => {
                if ctx.is_cancelled() {
                    let _ = std::fs::remove_file(output);
                    return Err(CANCELLED.to_string());
                }
                if payload.code == Some(0) {
                    ctx.emit(100.0, "tamamlandı");
                    return Ok((vec![output.to_string_lossy().to_string()], Vec::new()));
                }
                let detail = if last_err.trim().is_empty() {
                    match payload.code {
                        Some(code) => format!("ffmpeg çıkış kodu {code}"),
                        None => "ffmpeg sonlandı".to_string(),
                    }
                } else {
                    crate::convert::short_ffmpeg_error(&last_err)
                };
                let _ = std::fs::remove_file(output);
                return Err(format!("Dönüştürme başarısız: {detail}"));
            }
            _ => {}
        }
    }
    let _ = std::fs::remove_file(output);
    Err("ffmpeg çıkış durumu bildirmedi.".to_string())
}

fn audio_args(args: &mut Vec<String>, target: &str, options: &Value) {
    args.extend(["-vn".to_string()]);
    let bitrate = super::opt_str(options, "audio_bitrate").unwrap_or("192");
    match target {
        "mp3" => args.extend([
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            format!("{bitrate}k"),
            "-id3v2_version".into(),
            "3".into(),
        ]),
        "m4a" | "aac" => args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            format!("{bitrate}k"),
        ]),
        "wav" => args.extend(["-c:a".into(), "pcm_s16le".into()]),
        "flac" => args.extend(["-c:a".into(), "flac".into()]),
        "ogg" => args.extend(["-c:a".into(), "libvorbis".into(), "-q:a".into(), "5".into()]),
        "opus" => args.extend([
            "-c:a".into(),
            "libopus".into(),
            "-b:a".into(),
            format!("{bitrate}k"),
        ]),
        _ => {}
    }
    if let Some(rate) = super::opt_str(options, "sample_rate") {
        if rate != "original" {
            args.push("-ar".to_string());
            args.push(rate.to_string());
        }
    }
    match super::opt_str(options, "channels").unwrap_or("original") {
        "mono" => args.extend(["-ac".into(), "1".into()]),
        "stereo" => args.extend(["-ac".into(), "2".into()]),
        _ => {}
    }
}

fn video_args(args: &mut Vec<String>, target: &str, quality: &str, options: &Value) {
    let crf = match quality {
        "compact" => 28,
        "high" => 18,
        _ => 23,
    };
    let vp9_crf = match quality {
        "compact" => 40,
        "high" => 24,
        _ => 32,
    };
    let mpeg_q = match quality {
        "compact" => 8,
        "high" => 2,
        _ => 5,
    };
    let bitrate = super::opt_str(options, "audio_bitrate").unwrap_or("192");
    let mut filters: Vec<String> = Vec::new();
    if let Some(resolution) = super::opt_str(options, "resolution") {
        match resolution {
            "2160" | "1440" | "1080" | "720" | "480" | "360" => {
                filters.push(format!("scale=-2:{resolution}"));
            }
            _ => {}
        }
    }
    if let Some(fps) = super::opt_str(options, "fps") {
        if fps != "original" && fps.parse::<u32>().is_ok() {
            filters.push(format!("fps={fps}"));
        }
    }
    if !filters.is_empty() {
        args.push("-vf".to_string());
        args.push(filters.join(","));
    }
    let mute = super::opt_bool(options, "mute");
    match target {
        "webm" => {
            args.extend([
                "-c:v".into(),
                "libvpx-vp9".into(),
                "-crf".into(),
                vp9_crf.to_string(),
                "-b:v".into(),
                "0".into(),
                "-row-mt".into(),
                "1".into(),
            ]);
            if mute {
                args.push("-an".into());
            } else {
                args.extend([
                    "-c:a".into(),
                    "libopus".into(),
                    "-b:a".into(),
                    format!("{bitrate}k"),
                ]);
            }
        }
        "avi" => {
            args.extend([
                "-c:v".into(),
                "mpeg4".into(),
                "-q:v".into(),
                mpeg_q.to_string(),
            ]);
            if mute {
                args.push("-an".into());
            } else {
                args.extend([
                    "-c:a".into(),
                    "libmp3lame".into(),
                    "-b:a".into(),
                    format!("{bitrate}k"),
                ]);
            }
        }
        "mp4" | "mov" | "m4v" | "mkv" => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                crf.to_string(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if mute {
                args.push("-an".into());
            } else {
                args.extend([
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    format!("{bitrate}k"),
                ]);
            }
            if target != "mkv" {
                args.extend(["-movflags".into(), "+faststart".into()]);
            }
        }
        _ => {}
    }
}

fn gif_args(args: &mut Vec<String>, options: &Value) {
    let fps = super::opt_u32(options, "gif_fps", 12).clamp(5, 30);
    let width = super::opt_u32(options, "gif_width", 480).clamp(160, 960);
    args.extend([
        "-filter_complex".into(),
        format!(
            "fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5"
        ),
        "-loop".into(),
        "0".into(),
    ]);
}

fn parse_time(raw: Option<&str>) -> Option<f64> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(value) = raw.parse::<f64>() {
        return (value >= 0.0).then_some(value);
    }
    let parts: Vec<&str> = raw.split(':').collect();
    if parts.len() == 3 {
        let hours = parts[0].parse::<f64>().ok()?;
        let minutes = parts[1].parse::<f64>().ok()?;
        let seconds = parts[2].replace(',', ".").parse::<f64>().ok()?;
        return Some(hours * 3600.0 + minutes * 60.0 + seconds);
    }
    None
}

// --- görseller --------------------------------------------------------------

pub(crate) fn convert_image(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
    target: &str,
    options: &Value,
) -> Result<String, String> {
    let image = image::open(input).map_err(|e| format!("Görsel açılamadı: {e}"))?;
    let max_w = super::opt_u32(options, "max_width", 0);
    let max_h = super::opt_u32(options, "max_height", 0);
    let image = if max_w > 0 || max_h > 0 {
        let width = if max_w > 0 { max_w } else { image.width() };
        let height = if max_h > 0 { max_h } else { image.height() };
        image.thumbnail(width, height)
    } else {
        image
    };
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Çıktı klasörü açılamadı: {e}"))?;
    }
    let quality = super::opt_u32(options, "image_quality", 90).clamp(40, 100) as u8;
    if let Err(error) = save_image(&image, output, target, quality, options) {
        let _ = std::fs::remove_file(output);
        return Err(error);
    }
    ctx.emit(100.0, "tamamlandı");
    Ok(output.to_string_lossy().to_string())
}

fn save_image(
    image: &DynamicImage,
    output: &Path,
    target: &str,
    quality: u8,
    options: &Value,
) -> Result<(), String> {
    match target {
        "png" => image
            .save_with_format(output, ImageFormat::Png)
            .map_err(|e| format!("PNG yazılamadı: {e}")),
        "webp" => image
            .save_with_format(output, ImageFormat::WebP)
            .map_err(|e| format!("WebP yazılamadı: {e}")),
        "bmp" => image
            .save_with_format(output, ImageFormat::Bmp)
            .map_err(|e| format!("BMP yazılamadı: {e}")),
        "tiff" => image
            .save_with_format(output, ImageFormat::Tiff)
            .map_err(|e| format!("TIFF yazılamadı: {e}")),
        "gif" => image
            .save_with_format(output, ImageFormat::Gif)
            .map_err(|e| format!("GIF yazılamadı: {e}")),
        "jpg" => {
            let background = super::opt_str(options, "background")
                .and_then(parse_hex_color)
                .unwrap_or([255, 255, 255]);
            let rgb = flatten(image, background);
            let mut file =
                std::fs::File::create(output).map_err(|e| format!("Görsel yazılamadı: {e}"))?;
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, quality)
                .encode_image(&rgb)
                .map_err(|e| format!("JPEG yazılamadı: {e}"))
        }
        other => Err(format!("Görsel hedefi desteklenmiyor: {other}")),
    }
}

fn flatten(image: &DynamicImage, background: [u8; 3]) -> RgbImage {
    let rgba = image.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = pixel[3] as u16;
        let blend = |channel: u8, bg: u8| -> u8 {
            ((channel as u16 * alpha + bg as u16 * (255 - alpha)) / 255) as u8
        };
        out.put_pixel(
            x,
            y,
            image::Rgb([
                blend(pixel[0], background[0]),
                blend(pixel[1], background[1]),
                blend(pixel[2], background[2]),
            ]),
        );
    }
    out
}

fn parse_hex_color(value: &str) -> Option<[u8; 3]> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some([r, g, b])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_parser_accepts_seconds_and_clock() {
        assert_eq!(parse_time(Some("12.5")), Some(12.5));
        assert_eq!(parse_time(Some("01:02:03.5")), Some(3723.5));
        assert_eq!(parse_time(Some("")), None);
        assert_eq!(parse_time(None), None);
    }

    #[test]
    fn hex_color_parser_is_strict() {
        assert_eq!(parse_hex_color("#ffffff"), Some([255, 255, 255]));
        assert_eq!(parse_hex_color("000000"), Some([0, 0, 0]));
        assert_eq!(parse_hex_color("#fff"), None);
        assert_eq!(parse_hex_color("#zzzzzz"), None);
    }
}
