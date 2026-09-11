import { invoke } from '@tauri-apps/api/core';

export interface HealthToolStatus {
  available: boolean;
  version: string | null;
}

export interface HealthReport {
  ffmpeg: HealthToolStatus;
  ffprobe: HealthToolStatus;
  whisper: { available: boolean };
  models: { tiny: boolean; base: boolean; small: boolean };
  download_dir: string | null;
}

// Never-throw: backend'e ulaşılamazsa null döner, çağıran "bilinmiyor" gösterir.
export async function getHealth(): Promise<HealthReport | null> {
  try {
    const raw = await invoke<string>('health_check');
    return JSON.parse(raw) as HealthReport;
  } catch {
    return null;
  }
}
