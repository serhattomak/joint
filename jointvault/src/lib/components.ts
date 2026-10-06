/*
 * Bileşenler — indirme köprüsü ve durum sözleşmesi.
 *
 * 7b'den itibaren TÜM bileşen indirmeleri tek motordan (`component_download.rs`)
 * geçer ve tek olay yayar: `component-download-progress`. Olayın adı ve gövdesi
 * burada BİR kez tanımlanır; whisper/AI tüketicileri de buradan içe aktarır ki
 * kopyalar zamanla ayrışmasın (eskiden her modül kendi kopyasını taşıyordu).
 */
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { describeError } from './errors';

export interface ComponentStatus {
  id: string;
  label: string;
  /** İndirme boyutu; aynı arşivi paylaşan satırlar aynı sayıyı taşır. */
  approx_mb: number;
  /*
   * Bileşenin TÜRÜ — "çalıştırılamıyor" hükmünün tek kaynağı (Rust `Kind`):
   *   - `binary`: çalıştırılabilir dosya; `runnable` yalnızca bu türde anlamlıdır.
   *   - `asset`: veri dosyası (`.bin`/`.gguf` modeller ve cudart DLL kümesi).
   *     Kurulu olması DOSYANIN VARLIĞI demektir; hiçbir zaman çalışmaz, sürümü
   *     sorulmaz — bu bir kusur değil, "kurulum ≠ çalıştırma"dır. Kurulu asset
   *     yine de KULLANILABİLİR sayılır (bkz. `isUsable`).
   *
   * Alan geriye uyumluluk için opsiyoneldir: backend her zaman gönderir, ama
   * eski bir gövde `kind` taşımıyorsa tür kararı `runnable` yedeğine düşer
   * (fail-closed) — böylece türü bilinmeyen bir satır yanlışlıkla "kullanılamaz"
   * sayılıp yeniden indirilmez.
   */
  kind?: 'binary' | 'asset';
  installed: boolean;
  /** Dosya var VE çalıştırılabiliyor mu (sürüm okunabildi mi). */
  runnable: boolean;
  path: string | null;
  source: 'downloaded' | 'bundled' | null;
  version: string | null;
  /** Pinlenmiş kaynağı olmayan bileşen indirilebilir SAYILMAZ (ör. gömülü yt-dlp). */
  downloadable: boolean;
  /** Aynı arşivi paylaşan satırların paket kimliği (ör. `ffmpeg-tools`). */
  bundle: string | null;
  /** İçerik biçimi: `archive` (zip) ya da `plain`; indirilemeyende null. */
  framework: 'archive' | 'plain' | null;
}

/*
 * Kurulu bir bileşen KULLANILABİLİR mi? Backend'deki `components::is_usable`
 * kuralının BİREBİR aynısı:
 *
 *   installed && (kind === 'asset' || runnable)
 *
 * Neden yalnızca `runnable` yetmez? Kurulu bir `.bin`/`.gguf` modeli hiçbir zaman
 * çalışmaz (`runnable === false`, `version === null` — bu KASITLI, 7a sondası
 * `runnable === Boolean(version)` bekler). Eski `installed && runnable` kontrolü
 * onu "çalıştırılamıyor" gösterip her açılışta yeniden indirmeye çalışırdı. Tür
 * kararı bu yüzden `kind` ile verilir; `kind` yoksa (eski gövde) `runnable`
 * yedeğine düşeriz. Tek tanım burada yaşar; iki ekran da buradan okur ki
 * ayrışmasınlar.
 */
export function isUsable(component: ComponentStatus): boolean {
  return component.installed && (component.kind === 'asset' || component.runnable);
}

/** İndirme fazları (Rust `phase` alanının sözleşmesi). */
export type ComponentDownloadPhase = 'downloading' | 'verifying' | 'extracting' | 'done';

/** Tek indirme olayının adı; tüm indirmeler bunu yayar, tüketici `jobId` ile süzer. */
export const COMPONENT_DOWNLOAD_PROGRESS_EVENT = 'component-download-progress';

export interface ComponentDownloadProgressEvent {
  jobId: string;
  /** PAKET kimliği (ör. `ffmpeg-tools`) — satır id'si olmak zorunda değil. */
  componentId: string;
  /** -1 → toplam uzunluk bilinmiyor; "0" diye gösterilmemeli. */
  percent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  phase: ComponentDownloadPhase;
}

export interface ComponentDownloadResult {
  ok: boolean;
  error?: string;
}

/*
 * Ref-stable abonelik: her render'da callback tazelenir ama `listen` yeniden
 * kurulmaz. Unmount'ta bırakılır; `live` bayrağı, `listen` çözülmeden unmount
 * olunursa dinleyicinin sızmasını önler. Promise `void` ile bağlanır.
 *
 * Ref senkronu render'da DEĞİL, effect'te yapılır: render sırasında `ref.current`
 * yazmak oxlint'in `react/refs` kuralını tetikler (depoda bu desenin 6 kopyası
 * zaten uyarı üretiyor; burada yenisini eklemiyoruz).
 */
export function useComponentDownloadProgress(
  onEvent: (event: ComponentDownloadProgressEvent) => void,
): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  });
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<ComponentDownloadProgressEvent>(COMPONENT_DOWNLOAD_PROGRESS_EVENT, (event) => {
      ref.current(event.payload);
    }).then((u) => {
      if (live) unlisten = u;
      else u();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
}

/*
 * Bileşen indir. `componentId` kayıt id'sidir (`ffmpeg`), paket kimliği değil:
 * komut pinlenmiş kaynağı bu id ile çözer. Never-throw — reject
 * `{ ok: false, error }` olur ve hata metni backend'den hazır Türkçe gelir.
 */
export async function downloadComponent(
  componentId: string,
  jobId: string,
): Promise<ComponentDownloadResult> {
  try {
    await invoke<string>('component_download', {
      payload: { component_id: componentId, job_id: jobId },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, 'Bileşen indirilemedi.') };
  }
}

/*
 * Çalışan/kuyruktaki indirmeyi iptal et. Never-throw; `true` = iş bulundu.
 * İptal, indirme promise'ini redde düşürür; bu bir hata değildir (arayüz bilgi
 * bildirimi gösterir).
 */
export async function cancelComponentDownload(jobId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('component_cancel', { jobId });
  } catch {
    return false;
  }
}

// --- Eksik bileşen sinyali ---------------------------------------------------
//
// 7c-1'den itibaren ffmpeg'e bağlı her komut, aracı çözemezse şu TEL biçiminde
// reddeder: `BILESEN_EKSIK:<id>` + satır sonu + kullanıcıya hazır Türkçe cümle.
// Önek makine-okunurdur ve kullanıcıya ASLA gösterilmez; arayüzde onu tanıyan ve
// soyan tek yer burasıdır.
//
// Önek Rust'taki `MISSING_PREFIX` İLE AYNI olmak zorundadır: iki taraf ayrışırsa
// arayüz sessizce kör kalır ve kullanıcı ham makine metnini görür. Bu yüzden
// önek burada TEK kez tanımlanır; ayrıştırıcı ve metin yardımcısı onu paylaşır.

/** Eksik bileşen sinyalinin öneki. Makine-okunur; kullanıcıya GÖSTERİLMEZ. */
export const MISSING_COMPONENT_PREFIX = 'BILESEN_EKSIK:';

/*
 * Önekin işaretçi gövdesi (`BILESEN_EKSIK`) sabitten TÜRETİLİR: bağımsız bir
 * literal yazmak, kaçınmaya çalıştığımız ikinci bir tanım olurdu. Yalnızca
 * güvenlik ağıdır — bozuk bir sinyal id/detail içine işaretçi gömerse kullanıcı
 * metnine sızmasın diye kullanılır.
 */
const MISSING_COMPONENT_MARKER = MISSING_COMPONENT_PREFIX.replace(/:+$/, '');

/** Ayrıştırılmış eksik-bileşen sinyali. `detail` yoksa `''` — asla `undefined`. */
export interface MissingComponent {
  id: string;
  detail: string;
}

/*
 * `describeError` ile aynı öncelik: boş olmayan string, yoksa Error mesajı.
 * Fark: burada yedek metin YOKTUR — tanınmayan girdi boş string'e düşer ki
 * ayrıştırıcı fail-closed kalabilsin (throw etmez, `null` döner).
 */
const missingSignalText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return '';
};

/** İşaretçiyi metinden sıyırır (önekin kullanıcı metnine sızma yolu kapanır). */
const withoutMarker = (value: string): string =>
  value.split(MISSING_COMPONENT_MARKER).join('').trim();

/*
 * Tel sinyalini ayrıştırır (saf). Önek, kenar boşlukları atıldıktan SONRA BAŞTA
 * olmalıdır; ortada/sonda geçen önek eşleşmez. Yalnızca ilk satır id'dir ve boş
 * olamaz — bozuk sinyal asla geçerli sayılmaz (fail closed). `detail`, ilk satır
 * sonrasının tamamıdır (trim); satır yoksa `''`. Hiçbir girdi throw ettirmez.
 */
export function parseMissingComponent(error: unknown): MissingComponent | null {
  const rest = missingSignalText(error).trim();
  if (!rest.startsWith(MISSING_COMPONENT_PREFIX)) return null;
  const [idLine = '', ...detailLines] = rest.slice(MISSING_COMPONENT_PREFIX.length).split(/\r?\n/);
  const id = idLine.trim();
  if (id.length === 0) return null;
  return { id, detail: detailLines.join('\n').trim() };
}

/*
 * Bilinen id'ler için yedek cümleler. Metin kasıtlı olarak backend'in gömülü
 * ayrıntısıyla AYNI tutulur: ayrıntı satırı bir gün düşse bile kullanıcı aynı
 * dürüst cümleyi görür. Rust `missing_message` ile birebir eşleşir.
 */
const MISSING_COMPONENT_FALLBACKS = new Map<string, string>([
  [
    'ffmpeg',
    'ffmpeg kurulu değil. Dönüştürme, GIF, birleştirme, sessizlik, önizleme ve altyazı işlemleri bu aracı kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
  [
    'ffprobe',
    'ffprobe kurulu değil. Medya süresi ve biçim bilgisi bu araçla okunur; ffmpeg ile aynı pakette gelir. Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
  [
    'yt-dlp',
    'yt-dlp kurulu değil. İndirme Yöneticisi bu araç olmadan çalışamaz; uygulamayla birlikte gelir, eksikse kurulumu onarman gerekir.',
  ],
  [
    'whisper',
    'Whisper motoru kurulu değil. Altyazı işlemleri bu motoru kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
  [
    'whisper-cuda',
    'Whisper CUDA (GPU) motoru kurulu değil. Transkripti CPU’ya göre ~10 kat hızlandırır (NVIDIA GPU gerekir); Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
  [
    'whisper-model-tiny',
    "Whisper 'tiny' modeli kurulu değil. Hızlı taslak transkriptler bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.",
  ],
  [
    'whisper-model-base',
    "Whisper 'base' modeli kurulu değil. Dengeli hız/doğruluk için kullanılan transkript modelidir; Ayarlar → Bileşenler bölümünden indirebilirsin.",
  ],
  [
    'whisper-model-small',
    "Whisper 'small' modeli kurulu değil. Daha yüksek doğruluklu transkriptler bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.",
  ],
  [
    'whisper-model-large-v3-q5_0',
    "Whisper 'large-v3' (hızlı) modeli kurulu değil. Türkçe için yüksek doğruluklu transkriptler bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.",
  ],
  [
    'whisper-model-large-v3',
    "Whisper 'large-v3' modeli kurulu değil. En yüksek doğruluklu transkriptler bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.",
  ],
  [
    'llama-engine',
    'llama-server motoru kurulu değil. Yerel sohbet, özetleme ve etiketleme bu motoru kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
  [
    'llama-cudart',
    "CUDA çalışma zamanı kütüphaneleri (cudart/cublas) kurulu değil. llama-server'ın GPU'da çalışması bunlara bağlıdır; Ayarlar → Bileşenler bölümünden indirebilirsin.",
  ],
  [
    'ai-model-llm',
    'Qwen 2.5 14B sohbet modeli kurulu değil. Yerel sohbet ve özetleme bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
  [
    'ai-model-embed',
    'BGE-M3 gömme modeli kurulu değil. Anlamsal arama ve etiketleme bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.',
  ],
]);

const MISSING_COMPONENT_HINT =
  'Ayarlar → Bileşenler bölümünden bileşen durumunu denetleyebilirsin.';

/*
 * Bilinmeyen id'de dürüst genel cümle: ne olduğunu uydurmaz. id de işaretçiden
 * arındırılır ki çıktı hiçbir koşulda öneki taşımasın.
 */
const genericMissingComponentText = (id: string): string =>
  id.length > 0
    ? `'${id}' bileşeni kayıtlı değil ya da kurulu değil. ${MISSING_COMPONENT_HINT}`
    : `Bileşen kayıtlı değil ya da kurulu değil. ${MISSING_COMPONENT_HINT}`;

/*
 * Kullanıcıya dönük tek cümle: önce backend'in gömülü ayrıntısı (canlı, tek
 * doğru kaynak), yoksa bilinen id için sabit cümle, hiçbiri yoksa genel cümle.
 * Dönüş değeri ASLA öneki içermez — hem detail hem id işaretçiden arındırılır.
 */
export function missingComponentText(parsed: MissingComponent): string {
  const detail = withoutMarker(parsed.detail);
  if (detail.length > 0) return detail;
  const known = MISSING_COMPONENT_FALLBACKS.get(parsed.id);
  if (known !== undefined) return known;
  return genericMissingComponentText(withoutMarker(parsed.id));
}
