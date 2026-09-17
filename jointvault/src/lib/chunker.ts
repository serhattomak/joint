/**
 * Metin ve Transkript Parçalayıcı (Chunker) & Vektör Yardımcıları.
 *
 * Whisper transkriptlerini (SRT) zaman damgalı parçalara böler,
 * not ve başlıkları anlamsal aramaya hazır chunk'lara dönüştürür.
 */

export interface ItemChunk {
  id: string;
  itemId: string;
  chunkType: 'meta' | 'note' | 'transcript';
  chunkText: string;
  startSeconds?: number | null;
  endSeconds?: number | null;
  embedding?: string | null; // Base64 kodlanmış Float32Array
  createdAt?: string;
}

export interface SrtCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/**
 * '00:01:23,456' veya '00:01:23.456' biçimindeki zaman damgasını saniyeye çevirir.
 */
export function timeToSeconds(timeStr: string): number {
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(clean) || 0;
}

/**
 * Saniyeyi okunabilir zaman formatına çevirir (örn. 02:15 veya 01:14:30).
 */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remS = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(remS)}`;
  }
  return `${pad(m)}:${pad(remS)}`;
}

/**
 * Ham SRT altyazı metnini ayrıştırır.
 */
export function parseSrt(srtContent: string): SrtCue[] {
  if (!srtContent || !srtContent.trim()) return [];
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n+/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let timeLineIdx = 0;
    let idx = 0;
    if (/^\d+$/.test(lines[0]) && lines.length >= 2) {
      idx = parseInt(lines[0], 10);
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx];
    if (!timeLine || !timeLine.includes('-->')) continue;

    const [startRaw, endRaw] = timeLine.split('-->');
    if (!startRaw || !endRaw) continue;

    const startSeconds = timeToSeconds(startRaw);
    const endSeconds = timeToSeconds(endRaw);
    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join(' ').replace(/<[^>]+>/g, '').trim();

    if (text) {
      cues.push({
        index: idx || cues.length + 1,
        startSeconds,
        endSeconds,
        text,
      });
    }
  }

  return cues;
}

/**
 * SRT altyazılarını ~150-250 kelimelik veya maksimum ~45 saniyelik
 * anlamsal bloklar halinde gruplar.
 */
export function groupSrtIntoChunks(itemId: string, cues: SrtCue[]): ItemChunk[] {
  if (cues.length === 0) return [];
  const chunks: ItemChunk[] = [];

  let currentWords: string[] = [];
  let chunkStartSec = cues[0].startSeconds;
  let chunkEndSec = cues[0].endSeconds;

  const pushCurrent = () => {
    if (currentWords.length === 0) return;
    chunks.push({
      id: crypto.randomUUID(),
      itemId,
      chunkType: 'transcript',
      chunkText: currentWords.join(' ').trim(),
      startSeconds: chunkStartSec,
      endSeconds: chunkEndSec,
    });
    currentWords = [];
  };

  for (const cue of cues) {
    const cueWords = cue.text.split(/\s+/).filter(Boolean);
    if (cueWords.length === 0) continue;

    if (currentWords.length === 0) {
      chunkStartSec = cue.startSeconds;
    }

    currentWords.push(...cueWords);
    chunkEndSec = cue.endSeconds;

    // Kelime sayısı 180'i aştıysa veya zaman farkı 45 saniyeyi geçtiyse kes
    const duration = chunkEndSec - chunkStartSec;
    if (currentWords.length >= 180 || duration >= 45) {
      pushCurrent();
    }
  }

  pushCurrent();
  return chunks;
}

/**
 * Bir öğe için temel meta ve not chunk'larını oluşturur.
 */
export function buildMetaChunks(
  itemId: string,
  meta: {
    title?: string | null;
    platform?: string | null;
    note?: string | null;
    tags?: string[];
  }
): ItemChunk[] {
  const chunks: ItemChunk[] = [];

  const metaParts: string[] = [];
  if (meta.title) metaParts.push(`Başlık: ${meta.title}`);
  if (meta.platform && meta.platform !== 'other') metaParts.push(`Platform: ${meta.platform}`);
  if (meta.tags && meta.tags.length > 0) metaParts.push(`Etiketler: ${meta.tags.join(', ')}`);

  if (metaParts.length > 0) {
    chunks.push({
      id: crypto.randomUUID(),
      itemId,
      chunkType: 'meta',
      chunkText: metaParts.join('\n'),
      startSeconds: null,
      endSeconds: null,
    });
  }

  if (meta.note && meta.note.trim()) {
    chunks.push({
      id: crypto.randomUUID(),
      itemId,
      chunkType: 'note',
      chunkText: meta.note.trim(),
      startSeconds: null,
      endSeconds: null,
    });
  }

  return chunks;
}

// --- Vektör & Kosinüs Benzerliği ---

/**
 * Sayı dizisini (Float32) Base64 dizesine dönüştürür.
 */
export function vectorToBase64(floats: number[] | Float32Array): string {
  const arr = floats instanceof Float32Array ? floats : new Float32Array(floats);
  const bytes = new Uint8Array(arr.buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 dizesini Float32Array vektörüne dönüştürür.
 */
export function base64ToVector(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

/**
 * İki birim-normalize vektör arasındaki kosinüs benzerliğini (nokta çarpım) hesaplar.
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[]
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const valA = a[i];
    const valB = b[i];
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
