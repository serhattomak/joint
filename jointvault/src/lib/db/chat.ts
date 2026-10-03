/**
 * Sohbet oturumları ve mesajları için kalıcılık katmanı (SQLite).
 *
 * FTS senkronu `item_chunks_fts` ile AYNI desende açıktır: ekleme/silme her
 * iki tabloya birlikte yazılır (tetikleyici yok). Şema: göç 5.
 */
import { getDb } from './client';
import {
  formatChatMarkdown,
  sanitizeFtsQuery,
  sessionTitleFromFirstMessage,
  type VaultQueryItem,
} from '../ai-chat';
import type { HybridSearchResult } from './types';

export interface ChatSession {
  id: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  references_json: string | null;
  created_at: string;
}

/** Mesaja iliştirilen referans anlık görüntüsü (chunk ve/veya sorgu kayıtları). */
export interface ChatReferenceSnapshot {
  chunks?: HybridSearchResult[];
  query?: VaultQueryItem[];
}

export interface ChatSearchHit {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  snippet: string;
  createdAt: string;
}

type SessionRow = Omit<ChatSession, 'pinned'> & { pinned: number };

const DEFAULT_TITLE = 'Yeni sohbet';
const toSession = (r: SessionRow): ChatSession => ({ ...r, pinned: r.pinned === 1 });
const now = (): string => new Date().toISOString();

export async function createChatSession(title: string = DEFAULT_TITLE): Promise<ChatSession> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const ts = now();
  await db.execute(
    'INSERT INTO ai_chat_sessions (id, title, pinned, created_at, updated_at) VALUES ($1, $2, 0, $3, $3)',
    [id, title, ts],
  );
  return { id, title, pinned: false, created_at: ts, updated_at: ts };
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    'SELECT * FROM ai_chat_sessions ORDER BY pinned DESC, updated_at DESC',
  );
  return rows.map(toSession);
}

export async function getChatSession(id: string): Promise<ChatSession | null> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>('SELECT * FROM ai_chat_sessions WHERE id = $1', [id]);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function renameChatSession(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE ai_chat_sessions SET title = $1, updated_at = $2 WHERE id = $3', [
    title,
    now(),
    id,
  ]);
}

export async function setChatSessionPinned(id: string, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE ai_chat_sessions SET pinned = $1, updated_at = $2 WHERE id = $3', [
    pinned ? 1 : 0,
    now(),
    id,
  ]);
}

/** Oturumu siler. Mesajlar FK CASCADE ile gider; FTS açıkça temizlenir. */
export async function deleteChatSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM ai_chat_messages_fts WHERE session_id = $1', [id]);
  // FK CASCADE'a güvenilmez: mevcut kasada `PRAGMA foreign_keys` bağlantıda
  // yeniden çalışmamış olabilir; mesajları AÇIKÇA sil (yetim kayıt olmasın).
  await db.execute('DELETE FROM ai_chat_messages WHERE session_id = $1', [id]);
  await db.execute('DELETE FROM ai_chat_sessions WHERE id = $1', [id]);
}

export async function appendChatMessage(
  sessionId: string,
  input: { role: 'user' | 'assistant'; content: string; references?: ChatReferenceSnapshot },
): Promise<ChatMessageRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const ts = now();
  const refs = input.references ? JSON.stringify(input.references) : null;

  await db.execute(
    'INSERT INTO ai_chat_messages (id, session_id, role, content, references_json, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, sessionId, input.role, input.content, refs, ts],
  );
  await db.execute(
    'INSERT INTO ai_chat_messages_fts (message_id, session_id, content) VALUES ($1, $2, $3)',
    [id, sessionId, input.content],
  );

  // İlk kullanıcı mesajı: başlık hâlâ varsayılansa içerikten türet (elle adı ezme).
  if (input.role === 'user') {
    const rows = await db.select<SessionRow[]>('SELECT * FROM ai_chat_sessions WHERE id = $1', [
      sessionId,
    ]);
    const session = rows[0];
    if (session && (!session.title.trim() || session.title === DEFAULT_TITLE)) {
      await db.execute('UPDATE ai_chat_sessions SET title = $1 WHERE id = $2', [
        sessionTitleFromFirstMessage(input.content),
        sessionId,
      ]);
    }
  }

  await db.execute('UPDATE ai_chat_sessions SET updated_at = $1 WHERE id = $2', [ts, sessionId]);

  return {
    id,
    session_id: sessionId,
    role: input.role,
    content: input.content,
    references_json: refs,
    created_at: ts,
  };
}

export async function listChatMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const db = await getDb();
  return db.select<ChatMessageRow[]>(
    'SELECT * FROM ai_chat_messages WHERE session_id = $1 ORDER BY created_at ASC, rowid ASC',
    [sessionId],
  );
}

export async function searchChatMessages(q: string): Promise<ChatSearchHit[]> {
  const match = sanitizeFtsQuery(q);
  if (!match) return [];

  const db = await getDb();
  return db.select<ChatSearchHit[]>(
    `SELECT m.id AS messageId,
            m.session_id AS sessionId,
            s.title AS sessionTitle,
            m.created_at AS createdAt,
            snippet(ai_chat_messages_fts, 2, '', '', '…', 12) AS snippet
     FROM ai_chat_messages_fts f
     JOIN ai_chat_messages m ON m.id = f.message_id
     JOIN ai_chat_sessions s ON s.id = m.session_id
     WHERE ai_chat_messages_fts MATCH $1
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [match],
  );
}

export async function exportSessionMarkdown(sessionId: string): Promise<string | null> {
  const session = await getChatSession(sessionId);
  if (!session) return null;
  const messages = await listChatMessages(sessionId);
  return formatChatMarkdown(session.title, messages);
}
