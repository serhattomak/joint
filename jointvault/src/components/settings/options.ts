import type { SelectOption } from '@/components/ui/select';

/** Ayarlar sekmelerinin ortak seçenek listeleri. */

export const THRESHOLD_OPTIONS: SelectOption[] = ['0.3', '0.5', '0.6', '0.7', '0.8'].map((v) => ({
  value: v,
  label: v,
}));

export const DEDUPE_THRESHOLD_OPTIONS: SelectOption[] = [
  0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98,
].map((v) => ({ value: String(v), label: v.toFixed(2).replace('.', ',') }));

export const CLOSE_OPTIONS: SelectOption[] = [
  { value: 'tray', label: 'Çekmeceye küçült (arka planda çalış)' },
  { value: 'quit', label: 'Tamamen kapat' },
];

export const IDLE_OPTIONS: SelectOption[] = [
  { value: '0', label: 'Daima Hazır (Asla Uyutma - 0s)' },
  { value: '300', label: '5 Dakika' },
  { value: '600', label: '10 Dakika (Varsayılan)' },
  { value: '1800', label: '30 Dakika' },
  { value: '3600', label: '1 Saat' },
];

/** Hız sınırı seçenekleri (bayt/sn). 0 = sınırsız. */
export const SPEED_LIMIT_OPTIONS: SelectOption[] = [
  { value: '0', label: 'Sınırsız' },
  { value: String(1024 * 1024), label: '1 MB/s' },
  { value: String(2 * 1024 * 1024), label: '2 MB/s' },
  { value: String(4 * 1024 * 1024), label: '4 MB/s' },
  { value: String(8 * 1024 * 1024), label: '8 MB/s' },
  { value: String(16 * 1024 * 1024), label: '16 MB/s' },
];

export const CONCURRENCY_OPTIONS: SelectOption[] = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: `${n} indirme`,
}));

export const CONNECTION_OPTIONS: SelectOption[] = [
  { value: '4', label: '4 kanal' },
  { value: '8', label: '8 kanal (önerilen)' },
  { value: '16', label: '16 kanal' },
  { value: '32', label: '32 kanal' },
];

export const AFTER_COMPLETE_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'Hiçbir şey' },
  { value: 'open', label: 'Dosyayı aç' },
  { value: 'reveal', label: 'Klasörde göster' },
];

export const RETRY_OPTIONS: SelectOption[] = [0, 1, 2, 3, 5].map((n) => ({
  value: String(n),
  label: n === 0 ? 'Kapalı' : `${n} deneme`,
}));
