import type { SourceFamily } from '@/lib/conversion';

export interface ConversionSource {
  /** Arşiv kaydıysa item id'si; harici dosyada yolun kendisi. */
  id: string;
  path: string;
  name: string;
  ext: string;
  family: SourceFamily;
  size: number | null;
  origin: 'vault' | 'external' | 'folder';
  itemId?: string;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunJobView {
  id: string;
  name: string;
  path: string;
  target: string;
  status: RunStatus;
  percent: number;
  phase: string;
  outputs: string[];
  warnings: string[];
  error?: string;
  jobId?: string;
  /** Snapshot: çalıştırma anındaki hedef yol ve seçenekler. */
  outputPath: string;
  options: Record<string, unknown>;
  /** Arşiv kaydıysa dönüşüm sonrası `converted_path` güncellenir. */
  itemId?: string;
  family: SourceFamily;
}
