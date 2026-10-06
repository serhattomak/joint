import { invoke } from '@tauri-apps/api/core';
import { isHealthReport } from './backend-contracts';

export interface HealthToolStatus {
  available: boolean;
  version: string | null;
}

export interface HealthReport {
  ffmpeg: HealthToolStatus;
  ffprobe: HealthToolStatus;
  whisper: { available: boolean };
  models: {
    tiny: boolean;
    base: boolean;
    small: boolean;
    'large-v3-q5_0': boolean;
    'large-v3': boolean;
  };
  download_dir: string | null;
}

// Never-throw: backend'e ulaşılamazsa VEYA yanıt şekli beklenenden farklıysa
// null döner; çağıran "bilinmiyor" gösterir. Şekil uyuşmazlığı sessiz kalmaz.
export async function getHealth(): Promise<HealthReport | null> {
  try {
    const raw = await invoke<string>('health_check');
    const parsed: unknown = JSON.parse(raw);
    if (!isHealthReport(parsed)) {
      console.warn('[health_check] beklenmeyen yanıt şekli');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
