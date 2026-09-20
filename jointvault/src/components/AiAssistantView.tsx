import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Clock,
  CornerDownLeft,
  ExternalLink,
  FileText,
  RotateCcw,
  Sparkles,
  User,
  Video,
} from 'lucide-react';
import {
  applyCategorization,
  askVault,
  getAiStatus,
  isAiEnabled,
  useAiWarmupStatus,
  type AiStatus,
} from '@/lib/ai';
import { formatSeconds } from '@/lib/chunker';
import type { HybridSearchResult } from '@/lib/db/types';
import { PLATFORM_META } from '@/lib/platform';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: HybridSearchResult[];
  isStreaming?: boolean;
}

interface ActionTagPayload {
  itemId: string;
  itemTitle?: string;
  categories?: string[];
  tags?: string[];
}

function parseAssistantMessage(content: string): {
  cleanContent: string;
  actionPayload: ActionTagPayload | null;
} {
  const match = content.match(/```action:tag\s*([\s\S]*?)\s*```/);
  if (!match) {
    return { cleanContent: content, actionPayload: null };
  }

  const cleanContent = content.replace(match[0], '').trim();
  try {
    const parsed = JSON.parse(match[1]);
    return { cleanContent, actionPayload: parsed };
  } catch {
    return { cleanContent, actionPayload: null };
  }
}

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
  'Whisper transkriptlerinde en çok hangi konulardan bahsedilmiş?',
  'Son kaydettiğim eğitim ve yazılım içeriklerini özetle',
  'Kasamdaki pratik ipuçları ve notları listele',
];

interface AiAssistantViewProps {
  onOpenItem?: (itemId: string) => void;
  onOpenSettings?: () => void;
}

export function AiAssistantView({ onOpenItem, onOpenSettings }: AiAssistantViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [appliedActionIds, setAppliedActionIds] = useState<Set<string>>(new Set());
  const warmup = useAiWarmupStatus();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAiStatus().then(setStatus).catch(() => null);
  }, [warmup.status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Etkinlik TEK karar noktasından okunur (lib/ai.ts → isAiEnabled); bilinmeyen
  // durumda fail-closed "kapalı" sayılır. `status` henüz gelmediyken kapalı demek
  // yanlış olurdu, bu yüzden "durum bilinir mi" ayrıca izlenir.
  const statusKnown = status !== null;
  const aiEnabled = isAiEnabled(status);
  // `ready` artık etkinliği de kapsar: AI kapalıyken hiçbir IPC (warmup/embed/chat)
  // denenmez; kullanıcı sahte bir hata yerine dürüst durumu görür.
  const ready = aiEnabled && status?.engine_available === true && status?.llm_ready === true;

  const sendQuery = async (queryText: string) => {
    const q = queryText.trim();
    if (!q || busy || !aiEnabled) return;

    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: q },
      { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true },
    ]);

    setInput('');
    setBusy(true);

    try {
      const { answer, references } = await askVault(q, (token) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + token } : m,
          ),
        );
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: answer, references, isStreaming: false }
            : m,
        ),
      );
    } catch (e) {
      const errText =
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : 'Yanıt üretilirken bir hata oluştu.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `⚠️ ${errText}`,
                isStreaming: false,
              }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const clearChat = () => {
    if (busy) return;
    setMessages([]);
  };

  // Başlık alt metni SABİT donanım adı içermez: GPU gerçek tespitten gelir
  // (tespit yoksa dürüstçe "bilinmiyor"), modeller ise YALNIZCA diskte olanlardır.
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Üst Başlık & Durum Çubuğu */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Kasa Asistanı</h1>
            <p className="text-2xs text-muted-foreground">{headerDetail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
              VRAM'e Yükleniyor…
            </Badge>
          ) : status?.chat_server_running || warmup.status === 'ready' ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              {/* Offload CPU'ya düştüyse "VRAM Aktif" demek yalan olurdu: etiket
                  gerçek karara bağlı. (WMI'da VRAM okunamaz → CPU.) */}
              {status?.offload?.mode === 'cpu' ? 'CPU (Anında Yanıt)' : 'VRAM Aktif (Anında Yanıt)'}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border bg-muted/30 text-muted-foreground">
              ● AI Hazır (Uyku Modunda)
            </Badge>
          )}

          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              disabled={busy}
              title="Sohbeti Temizle"
            >
              <RotateCcw className="size-3.5" />
            </Button>
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
          // AI kapalı NORMAL bir yapılandırmadır: hata tonu değil, nötr durum +
          // gerçekten çalışan bir yönlendirme düğmesi (ölü düğme yok).
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
              üzerinde anlamsal arama yapar; kaynak göstererek sorularını yanıtlar.
            </p>

            <div className="mt-8 flex w-full flex-col gap-2">
              <span className="text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Örnek Sorular
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void sendQuery(p)}
                    disabled={!ready || busy}
                    className="rounded-lg border border-border bg-card/60 p-3 text-left text-xs text-card-foreground transition hover:border-primary/40 hover:bg-card active:scale-[0.99] disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {messages.map((m) => {
              const { cleanContent, actionPayload } =
                m.role === 'assistant'
                  ? parseAssistantMessage(m.content)
                  : { cleanContent: m.content, actionPayload: null };

              return (
                <div
                  key={m.id}
                  className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Sparkles className="size-3.5" />
                    </div>
                  )}

                  <div
                    className={`flex flex-col gap-2 rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'max-w-[85%] bg-primary text-primary-foreground'
                        : 'max-w-full border border-border bg-card text-card-foreground'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">
                      {cleanContent}
                      {m.isStreaming && (
                        <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-primary align-middle" />
                      )}
                    </div>

                    {/* Doğrudan Etiketleme Onay Kartı */}
                    {actionPayload && (
                      <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                            <Sparkles className="size-3.5 shrink-0" />
                            <span className="truncate">Eylem Önerisi: {actionPayload.itemTitle || 'Kasaya Ekle'}</span>
                          </div>
                          <Button
                            variant={appliedActionIds.has(m.id) ? 'outline' : 'default'}
                            size="sm"
                            className="h-6 shrink-0 gap-1 px-2.5 text-3xs font-medium"
                            disabled={appliedActionIds.has(m.id)}
                            onClick={async () => {
                              await applyCategorization(
                                actionPayload.itemId,
                                actionPayload.categories || [],
                                actionPayload.tags || [],
                              );
                              setAppliedActionIds((prev) => new Set(prev).add(m.id));
                            }}
                          >
                            {appliedActionIds.has(m.id) ? '✓ Kasaya Uygulandı' : 'Kasaya Uygula'}
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                          {actionPayload.categories && actionPayload.categories.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-3xs font-medium text-muted-foreground">Kategori:</span>
                              {actionPayload.categories.map((c) => (
                                <Badge key={c} variant="outline" className="border-primary/40 text-3xs text-primary">
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {actionPayload.tags && actionPayload.tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-3xs font-medium text-muted-foreground">Etiketler:</span>
                              {actionPayload.tags.map((t) => (
                                <Badge key={t} variant="secondary" className="font-mono text-3xs">
                                  #{t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Kaynak Kartları (Referanslar) */}
                    {m.references && m.references.length > 0 && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                          Referans Alınan İçerikler ({m.references.length})
                        </span>
                        <div className="mt-2 flex flex-col gap-2">
                          {m.references.map((ref) => {
                            const pMeta = PLATFORM_META[ref.item.platform as keyof typeof PLATFORM_META] ?? PLATFORM_META.other;
                            const hasTime =
                              ref.chunk.start_seconds !== null &&
                              ref.chunk.start_seconds !== undefined;

                            return (
                              <div
                                key={ref.chunk.id}
                                className="group flex flex-col gap-1.5 rounded-lg border border-border/80 bg-background/50 p-2.5 transition hover:border-border hover:bg-background"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <Badge variant="outline" className="px-1 py-0 text-3xs">
                                      {pMeta.label}
                                    </Badge>
                                    <Badge variant="outline" className="px-1 py-0 text-3xs">
                                      {ref.chunk.chunk_type === 'transcript' ? (
                                        <span className="flex items-center gap-1">
                                          <Video className="size-2.5" /> Transkript
                                        </span>
                                      ) : (
                                        <span className="flex items-center gap-1">
                                          <FileText className="size-2.5" /> Not
                                        </span>
                                      )}
                                    </Badge>

                                    <span
                                      className="cursor-pointer truncate text-xs font-medium text-foreground hover:underline"
                                      onClick={() => onOpenItem?.(ref.item.id)}
                                      title={ref.item.title || ref.item.url}
                                    >
                                      {ref.item.title || ref.item.url}
                                    </span>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1.5">
                                        {hasTime && typeof ref.chunk.start_seconds === 'number' && (
                                          <Badge
                                            variant="secondary"
                                            className="flex items-center gap-1 font-mono text-3xs text-muted-foreground"
                                          >
                                            <Clock className="size-2.5" />
                                            {formatSeconds(ref.chunk.start_seconds)}
                                          </Badge>
                                        )}

                                    <a
                                      href={ref.item.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-muted-foreground hover:text-foreground"
                                      title="Orijinal bağlantıyı aç"
                                    >
                                      <ExternalLink className="size-3" />
                                    </a>
                                  </div>
                                </div>

                                <p className="line-clamp-2 text-2xs text-muted-foreground/90">
                                  {ref.chunk.chunk_text}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {m.role === 'user' && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <User className="size-3.5" />
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Giriş çubuğu YALNIZCA AI etkinken çizilir: kapalıyken yazılabilir bir
          kutu gösterip gönderimde hataya düşmek yanıltıcı olurdu. */}
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
          className="mx-auto flex max-w-2xl items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-xs focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/60"
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
  );
}
