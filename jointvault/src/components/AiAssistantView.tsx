import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  CornerDownLeft,
  Download,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Sparkles,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { askVault, getAiStatus, isAiEnabled, useAiWarmupStatus, type AiStatus } from '@/lib/ai';
import {
  appendChatMessage,
  createChatSession,
  deleteChatSession,
  exportSessionMarkdown,
  listChatMessages,
  listChatSessions,
  renameChatSession,
  searchChatMessages,
  setChatSessionPinned,
  type ChatMessageRow,
  type ChatSearchHit,
  type ChatSession,
} from '@/lib/db/chat';
import { ChatHistoryPanel } from '@/components/ChatHistoryPanel';
import { ChatMessages, type ChatMessage } from '@/components/ChatMessages';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const SMART_PROMPT_TEMPLATES = [
  {
    label: 'Haftalık Kasa Özeti',
    prompt: 'Son kaydettiğim içeriklerin ana temalarını ve önemli noktalarını özetle.',
  },
  {
    label: 'Video Zaman Çizelgesi',
    prompt: 'Kasamdaki videolardan önemli zaman damgalarını ve konu başlıklarını listele.',
  },
  {
    label: 'Pratik İpuçları',
    prompt: 'Transkript ve notlarımdaki en vurucu pratik ipuçlarını ve tavsiyeleri çıkar.',
  },
  {
    label: 'Kategori Analizi',
    prompt: 'Kasamdaki içerikleri konularına göre grupla ve eksik gördüğün alanları belirt.',
  },
  {
    label: 'Etiket Önerileri',
    prompt: 'Kasamdaki içerikleri incele ve düzenlenmesi gereken etiketler öner.',
  },
];

const SAMPLE_PROMPTS = [
  'Kasamda yapay zekâ ve makine öğrenimiyle ilgili hangi videolar var?',
  'Kaç favori kaydım var?',
  'Rust etiketli YouTube kayıtlarını listele',
  'Son kaydettiğim eğitim ve yazılım içeriklerini özetle',
];

const SESSION_KEY = 'jv-ai-session';
const HISTORY_KEY = 'jv-ai-history';

function toChatMessage(row: ChatMessageRow): ChatMessage {
  let references: ChatMessage['references'];
  let queryItems: ChatMessage['queryItems'];
  if (row.references_json) {
    try {
      const parsed = JSON.parse(row.references_json) as {
        chunks?: ChatMessage['references'];
        query?: ChatMessage['queryItems'];
      };
      references = parsed.chunks;
      queryItems = parsed.query;
    } catch {
      // bozuk referans anlık görüntüsü: metin yine gösterilir
    }
  }
  return { id: row.id, role: row.role, content: row.content, references, queryItems };
}

interface AiAssistantViewProps {
  onOpenItem?: (itemId: string) => void;
  onOpenSettings?: () => void;
}

export function AiAssistantView({ onOpenItem, onOpenSettings }: AiAssistantViewProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'streaming' | 'querying'>('idle');
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [searchResults, setSearchResults] = useState<ChatSearchHit[]>([]);
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem(HISTORY_KEY) !== '0');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
  const warmup = useAiWarmupStatus();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAiStatus().then(setStatus).catch(() => null);
  }, [warmup.status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Arama sonucundan gelindiğinde ilgili mesaja kaydır (mesajlar yüklenince dener).
  useEffect(() => {
    if (!scrollTargetId) return;
    const el = document.getElementById(`msg-${scrollTargetId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setScrollTargetId(null);
  }, [scrollTargetId, messages]);

  const refreshSessions = useCallback(async () => {
    setSessions(await listChatSessions());
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    setMessages((await listChatMessages(id)).map(toChatMessage));
  }, []);

  // Açılışta: oturumları yükle, son seçili ya da ilk oturumu aç.
  useEffect(() => {
    void (async () => {
      try {
        const list = await listChatSessions();
        setSessions(list);
        const stored = localStorage.getItem(SESSION_KEY);
        const pick = list.find((s) => s.id === stored) ?? list[0];
        if (pick) {
          setActiveId(pick.id);
          localStorage.setItem(SESSION_KEY, pick.id);
          await loadMessages(pick.id);
        }
      } catch {
        // veritabanı henüz hazır değilse sohbet boş açılır
      }
    })();
  }, [loadMessages]);

  const statusKnown = status !== null;
  const aiEnabled = isAiEnabled(status);
  const ready = aiEnabled && status?.engine_available === true && status?.llm_ready === true;

  const selectSession = useCallback(
    (id: string) => {
      if (busy) return;
      setActiveId(id);
      localStorage.setItem(SESSION_KEY, id);
      setSearchResults([]);
      void loadMessages(id);
    },
    [busy, loadMessages],
  );

  const createSession = useCallback(async () => {
    const s = await createChatSession();
    setActiveId(s.id);
    localStorage.setItem(SESSION_KEY, s.id);
    setMessages([]);
    await refreshSessions();
    return s.id;
  }, [refreshSessions]);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    void searchChatMessages(q)
      .then(setSearchResults)
      .catch(() => setSearchResults([]));
  }, []);

  const sendQuery = async (queryText: string) => {
    const q = queryText.trim();
    if (!q || busy || !aiEnabled) return;

    let sid = activeId;
    if (!sid) sid = await createSession();

    const history = messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));
    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: q },
      { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true },
    ]);
    setInput('');
    setBusy(true);
    setPhase('streaming');

    void appendChatMessage(sid, { role: 'user', content: q })
      .then(refreshSessions)
      .catch(() => null);

    try {
      const { answer, references, queryItems } = await askVault(q, {
        history,
        onToken: (token) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + token } : m)),
          ),
        onStatus: setPhase,
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: answer, references, queryItems, isStreaming: false }
            : m,
        ),
      );

      await appendChatMessage(sid, {
        role: 'assistant',
        content: answer,
        references: { chunks: references, query: queryItems },
      });
      await refreshSessions();
    } catch (e) {
      const errText =
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Yanıt üretilirken bir hata oluştu.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, content: `⚠️ ${errText}`, isStreaming: false } : m,
        ),
      );
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  };

  const togglePin = async (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    await setChatSessionPinned(id, !s.pinned);
    await refreshSessions();
  };

  const removeSession = async (id: string) => {
    await deleteChatSession(id);
    const list = await listChatSessions();
    setSessions(list);
    if (id !== activeId) return;
    const next = list[0]?.id;
    if (next) {
      setActiveId(next);
      localStorage.setItem(SESSION_KEY, next);
      await loadMessages(next);
    } else {
      await createSession();
    }
  };

  const doExport = async () => {
    if (!activeId) return;
    const md = await exportSessionMarkdown(activeId);
    if (!md) return;
    const title = sessions.find((s) => s.id === activeId)?.title ?? 'sohbet';
    await invoke('export_backup', {
      content: md,
      suggestedName: `${title}.md`,
      filterName: 'Markdown',
      extensions: ['md'],
    });
  };

  const toggleHistory = () => {
    setHistoryOpen((open) => {
      localStorage.setItem(HISTORY_KEY, open ? '0' : '1');
      return !open;
    });
  };

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const gpuLabel = status?.gpu?.name?.trim() || 'bilinmiyor';
  const modelParts = [
    ...(status?.llm_ready ? ['Qwen 2.5 14B'] : []),
    ...(status?.embed_ready ? ['BGE-M3'] : []),
  ];
  const headerDetail = !statusKnown
    ? 'AI durumu kontrol ediliyor…'
    : !aiEnabled
      ? "AI kapalı — Ayarlar'dan aç"
      : [gpuLabel, ...(modelParts.length > 0 ? modelParts : ['model yok'])].join(' · ');

  return (
    <div className="relative flex h-full overflow-hidden bg-background">
      {/* Dar pencerede çekmece perdesi */}
      {historyOpen && (
        <div
          className="absolute inset-0 z-20 bg-overlay md:hidden"
          onClick={toggleHistory}
          aria-hidden
        />
      )}

      {historyOpen && (
        <div className="absolute inset-y-0 left-0 z-30 material-rail md:relative md:z-auto">
          <ChatHistoryPanel
            sessions={sessions}
            activeId={activeId}
            searchResults={searchResults}
            onSelect={selectSession}
            onCreate={() => void createSession()}
            onRename={(id, title) => void renameChatSession(id, title).then(refreshSessions)}
            onTogglePin={(id) => void togglePin(id)}
            onDelete={setConfirmDeleteId}
            onSearch={doSearch}
            onOpenResult={(hit) => {
              selectSession(hit.sessionId);
              setScrollTargetId(hit.messageId);
              setHistoryOpen(false);
            }}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Üst Başlık & Durum Çubuğu */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              variant="ghost"
              size="sm"
              className="size-8 shrink-0 p-0"
              title={historyOpen ? 'Geçmişi gizle' : 'Geçmişi göster'}
              onClick={toggleHistory}
            >
              <PanelLeft className="size-4" />
            </Button>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">
                {activeSession?.title || 'Kasa Asistanı'}
              </h1>
              <p className="truncate text-2xs text-muted-foreground">{headerDetail}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {!statusKnown ? null : !aiEnabled ? (
              <Badge variant="outline" className="border-border bg-muted/30 text-muted-foreground">
                ● AI Kapalı
              </Badge>
            ) : !ready ? (
              onOpenSettings ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenSettings}
                  className="text-amber-600 dark:text-amber-400"
                >
                  Modeller Eksik — Ayarlar'dan Kur
                </Button>
              ) : null
            ) : warmup.status === 'loading' ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              >
                <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
                VRAM'e Yükleniyor…
              </Badge>
            ) : status?.chat_server_running || warmup.status === 'ready' ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                {status?.offload?.mode === 'cpu' ? 'CPU (Anında Yanıt)' : 'VRAM Aktif (Anında Yanıt)'}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border bg-muted/30 text-muted-foreground">
                ● AI Hazır (Uyku Modunda)
              </Badge>
            )}

            {activeSession && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  title={activeSession.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
                  onClick={() => void togglePin(activeSession.id)}
                >
                  {activeSession.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  title="Markdown olarak dışa aktar"
                  onClick={() => void doExport()}
                  disabled={messages.length === 0}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  title="Yeni sohbet"
                  onClick={() => void createSession()}
                  disabled={busy}
                >
                  <Plus className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Mesaj Akışı / Sohbet Alanı */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {!statusKnown ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">AI durumu kontrol ediliyor…</p>
            </div>
          ) : !aiEnabled ? (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center pt-16 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Bot className="size-6" />
              </div>
              <h2 className="text-base font-medium">AI kapalı</h2>
              <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                Kasa Asistanı ve semantik arama devre dışı. Yerel AI yalnızca sen açtığında çalışır;
                bu bir hata değil, beklenen bir ayar durumudur.
              </p>
              {onOpenSettings && (
                <Button variant="outline" size="sm" className="mt-5 gap-1.5" onClick={onOpenSettings}>
                  <Sparkles className="size-3.5" />
                  Ayarlar'dan Aç
                </Button>
              )}
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center pt-12 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                <Bot className="size-6" />
              </div>
              <h2 className="text-base font-medium">Kasanla Doğal Dille Konuş</h2>
              <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
                Kaydettiğin tüm linkler, kişisel notların ve Whisper ile üretilen video transkriptleri
                üzerinde anlamsal arama yapar; kaynak göstererek sorularını yanıtlar. Kasanın
                etiketleri, kategorileri ve sayımları hakkında da yapısal soru sorabilirsin.
              </p>

              <div className="mt-8 flex w-full flex-col gap-2">
                <span className="text-left text-2xs font-medium text-muted-foreground/70">
                  Örnek Sorular
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SAMPLE_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void sendQuery(p)}
                      disabled={!ready || busy}
                      className="settings-card p-3 text-left text-xs text-card-foreground transition hover:border-primary/40 active:scale-[0.99] disabled:opacity-50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <ChatMessages
                messages={messages}
                onOpenItem={onOpenItem}
                querying={phase === 'querying'}
              />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Giriş çubuğu YALNIZCA AI etkinken çizilir. */}
        {statusKnown && aiEnabled && (
          <footer className="shrink-0 border-t border-border bg-card/20 p-3 md:p-4">
            <div className="mx-auto mb-2 flex max-w-2xl items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <span className="flex shrink-0 items-center gap-1 text-3xs font-medium text-muted-foreground">
                <Sparkles className="size-3 text-primary" /> Hızlı Analiz:
              </span>
              {SMART_PROMPT_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.label}
                  type="button"
                  disabled={!ready || busy}
                  onClick={() => void sendQuery(tmpl.prompt)}
                  className="shrink-0 rounded-full border border-border/70 bg-card/80 px-2.5 py-1 text-3xs text-muted-foreground transition hover:border-primary/40 hover:bg-card hover:text-foreground active:scale-95 disabled:opacity-50"
                >
                  {tmpl.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendQuery(input);
              }}
              className="settings-card mx-auto flex max-w-2xl items-center gap-2 px-3 py-2 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/60"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  ready
                    ? 'Kasan hakkında bir soru sor… (örn: "Rust async videoları")'
                    : 'AI motoru hazır değil. Ayarlar sekmesinden modeli kur.'
                }
                disabled={!ready || busy}
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!ready || busy || input.trim().length === 0}
                className="size-8 p-0"
              >
                <CornerDownLeft className="size-4" />
              </Button>
            </form>
          </footer>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title="Sohbeti sil"
        description="Bu oturum ve tüm mesajları kalıcı olarak silinecek. Bu işlem geri alınamaz."
        confirmLabel="Sil"
        onConfirm={() => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id) void removeSession(id);
        }}
      />
    </div>
  );
}
