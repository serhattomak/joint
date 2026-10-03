/**
 * Sohbet yüzeyi için SAF yardımcılar.
 *
 * Burada Tauri/IPC veya veritabanı yoktur: ayrıştırma, bağlam penceresi,
 * başlık üretimi, FTS süzme ve markdown biçimi. Böylece hepsi Node'da
 * test edilebilir kalır (bkz. ai-chat.test.ts).
 */

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface VaultQueryItem {
  id: string;
  title: string | null;
  url: string;
  platform: string;
  favorite: boolean;
  downloaded: boolean;
  createdAt: string;
}

export interface ActionTagPayload {
  itemId: string;
  itemTitle?: string;
  categories?: string[];
  tags?: string[];
}

export interface ActionQueryPayload {
  filters?: Record<string, unknown>;
  limit?: number;
  countOnly?: boolean;
}

const TAG_RE = /```action:tag\s*([\s\S]*?)\s*```/;
const QUERY_RE = /```action:query\s*([\s\S]*?)\s*```/;

/**
 * Asistan yanıtından `action:tag` / `action:query` bloklarını ayıklar.
 *
 * Bozuk JSON sessizce yok sayılır (ilgili eylem `null`) ama metin korunur:
 * model kurala uymazsa sohbet akmaya devam eder.
 */
export function parseAssistantMessage(content: string): {
  cleanContent: string;
  actionTag: ActionTagPayload | null;
  actionQuery: ActionQueryPayload | null;
} {
  let cleanContent = content;
  let actionTag: ActionTagPayload | null = null;
  let actionQuery: ActionQueryPayload | null = null;

  const tagMatch = cleanContent.match(TAG_RE);
  if (tagMatch) {
    cleanContent = cleanContent.replace(tagMatch[0], '');
    try {
      actionTag = JSON.parse(tagMatch[1]) as ActionTagPayload;
    } catch {
      actionTag = null;
    }
  }

  const queryMatch = cleanContent.match(QUERY_RE);
  if (queryMatch) {
    cleanContent = cleanContent.replace(queryMatch[0], '');
    try {
      actionQuery = JSON.parse(queryMatch[1]) as ActionQueryPayload;
    } catch {
      actionQuery = null;
    }
  }

  return { cleanContent: cleanContent.trim(), actionTag, actionQuery };
}

/**
 * Sondan başa karakter bütçesine sığan mesajları döndürür.
 *
 * En yeni mesaj HER ZAMAN korunur (tek mesaj bütçeden büyük olsa bile):
 * aksi hâlde son soru modele hiç ulaşmazdı.
 */
export function buildHistoryWindow(
  messages: HistoryMessage[],
  charBudget: number,
): HistoryMessage[] {
  if (messages.length === 0) return [];

  const window: HistoryMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const len = msg.content.length;
    if (window.length > 0 && used + len > charBudget) break;
    window.unshift(msg);
    used += len;
  }
  return window;
}

/** İlk kullanıcı mesajından oturum başlığı üretir (ilk ~40 karakter). */
export function sessionTitleFromFirstMessage(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Yeni sohbet';
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
}

/**
 * Kullanıcı metnini FTS5 MATCH için güvenli tümce sorgusuna çevirir.
 *
 * Tırnak ve operatör karakterleri tümce içinde düz metin olur; boş sorgu ''
 * döner ve çağıran aramayı atlar. Özel karakter yüzünden SQL hatası oluşmaz.
 */
export function sanitizeFtsQuery(q: string): string {
  const clean = q.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? `"${clean}"` : '';
}

/** Oturumu paylaşılabilir Markdown'a çevirir; eylem blokları yazılmaz. */
export function formatChatMarkdown(
  title: string,
  messages: { role: 'user' | 'assistant'; content: string; created_at: string }[],
): string {
  let md = `# ${title}\n`;
  if (messages.length === 0) return md;

  for (const m of messages) {
    const label = m.role === 'user' ? 'Kullanıcı' : 'Asistan';
    const body = m.role === 'assistant' ? parseAssistantMessage(m.content).cleanContent : m.content;
    md += `\n## ${label}\n${body}\n`;
  }
  return md;
}
