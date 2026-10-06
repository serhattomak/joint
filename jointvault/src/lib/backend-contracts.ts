/*
 * Rust tarafından gelen JSON yüklerinin şekli.
 *
 * Sözleşmeler tek yerde durur çünkü iki dil arasındaki tek gerçek arayüz
 * bunlar. Doğrulama başarısızsa çağıran "bilinmiyor" der — yanlış şekilli
 * veriyle sessizce devam etmez.
 *
 * Tipler `import type` ile alınır: derlemede tamamen silinir, bu yüzden bu
 * modül Tauri'ye bağlı olmadan (ve test edilebilir biçimde) yüklenir.
 */
import type { HealthReport } from './health';
import { isBoolean, isNullableString, isRecord, isString } from './json';
import type { TranscriptData, WhisperStatus } from './whisper';

const isToolStatus = (value: unknown): boolean =>
  isRecord(value) && isBoolean(value.available) && isNullableString(value.version);

const isModelFlags = (value: unknown): boolean =>
  isRecord(value) &&
  isBoolean(value.tiny) &&
  isBoolean(value.base) &&
  isBoolean(value.small) &&
  isBoolean(value['large-v3-q5_0']) &&
  isBoolean(value['large-v3']);

export const isHealthReport = (value: unknown): value is HealthReport =>
  isRecord(value) &&
  isToolStatus(value.ffmpeg) &&
  isToolStatus(value.ffprobe) &&
  isRecord(value.whisper) &&
  isBoolean(value.whisper.available) &&
  isModelFlags(value.models) &&
  isNullableString(value.download_dir);

export const isWhisperStatus = (value: unknown): value is WhisperStatus =>
  isRecord(value) &&
  isBoolean(value.whisper_available) &&
  isModelFlags(value.models) &&
  isString(value.models_dir);

export const isTranscriptData = (value: unknown): value is TranscriptData =>
  isRecord(value) && isString(value.srt_path) && isString(value.preview) && isString(value.language);
