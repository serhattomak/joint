import { useState } from 'react';
import { Clock, ExternalLink, FileText, Loader2, Sparkles, User, Video } from 'lucide-react';
import { applyCategorization } from '@/lib/ai';
import { parseAssistantMessage, type VaultQueryItem } from '@/lib/ai-chat';
import { formatSeconds } from '@/lib/chunker';
import type { HybridSearchResult } from '@/lib/db/types';
import { PLATFORM_META } from '@/lib/platform';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: HybridSearchResult[];
  queryItems?: VaultQueryItem[];
  isStreaming?: boolean;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  onOpenItem?: (itemId: string) => void;
  /** Yapısal sorgu sürüyorsa akan mesajda "Kasa taranıyor…" gösterilir. */
  querying: boolean;
}

/** "Bulunan Kayıtlar" — yapısal sorgu sonucu satırları. */
function QueryResultCards({
  items,
  onOpenItem,
}: {
  items: VaultQueryItem[];
  onOpenItem?: (itemId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <span className="text-2xs font-medium text-muted-foreground">
        Bulunan Kayıtlar ({items.length})
      </span>
      <div className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => {
          const pMeta =
            PLATFORM_META[item.platform as keyof typeof PLATFORM_META] ?? PLATFORM_META.other;
          return (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-background/50 p-2.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Badge variant="outline" className="px-1 py-0 text-3xs">
                  {pMeta.label}
                </Badge>
                <button
                  type="button"
                  onClick={() => onOpenItem?.(item.id)}
                  className="truncate text-xs font-medium text-foreground hover:underline"
                  title={item.title || item.url}
                >
                  {item.title || item.url}
                </button>
              </div>
              <span className="shrink-0 text-2xs text-muted-foreground" data-num>
                {item.createdAt.slice(0, 10)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChatMessages({ messages, onOpenItem, querying }: ChatMessagesProps) {
  const [appliedActionIds, setAppliedActionIds] = useState<Set<string>>(new Set());

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {messages.map((m) => {
        const { cleanContent, actionTag } =
          m.role === 'assistant'
            ? parseAssistantMessage(m.content)
            : { cleanContent: m.content, actionTag: null };

        return (
          <div
            key={m.id}
            id={`msg-${m.id}`}
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
                {querying && m.isStreaming && !cleanContent ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Kasa taranıyor…
                  </span>
                ) : (
                  <>
                    {cleanContent}
                    {m.isStreaming && !querying && (
                      <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-primary align-middle" />
                    )}
                  </>
                )}
              </div>

              {/* Doğrudan Etiketleme Onay Kartı */}
              {actionTag && (
                <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles className="size-3.5 shrink-0" />
                      <span className="truncate">Eylem Önerisi: {actionTag.itemTitle || 'Kasaya Ekle'}</span>
                    </div>
                    <Button
                      variant={appliedActionIds.has(m.id) ? 'outline' : 'default'}
                      size="sm"
                      className="h-6 shrink-0 gap-1 px-2.5 text-3xs font-medium"
                      disabled={appliedActionIds.has(m.id)}
                      onClick={async () => {
                        await applyCategorization(
                          actionTag.itemId,
                          actionTag.categories || [],
                          actionTag.tags || [],
                        );
                        setAppliedActionIds((prev) => new Set(prev).add(m.id));
                      }}
                    >
                      {appliedActionIds.has(m.id) ? '✓ Kasaya Uygulandı' : 'Kasaya Uygula'}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                    {actionTag.categories && actionTag.categories.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-3xs font-medium text-muted-foreground">Kategori:</span>
                        {actionTag.categories.map((c) => (
                          <Badge key={c} variant="outline" className="border-primary/40 text-3xs text-primary">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {actionTag.tags && actionTag.tags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-3xs font-medium text-muted-foreground">Etiketler:</span>
                        {actionTag.tags.map((t) => (
                          <Badge key={t} variant="secondary" className="font-mono text-3xs">
                            #{t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {m.queryItems && m.queryItems.length > 0 && (
                <QueryResultCards items={m.queryItems} onOpenItem={onOpenItem} />
              )}

              {/* Kaynak Kartları (Referanslar) */}
              {m.references && m.references.length > 0 && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <span className="text-2xs font-medium text-muted-foreground">
                    Referans Alınan İçerikler ({m.references.length})
                  </span>
                  <div className="mt-2 flex flex-col gap-2">
                    {m.references.map((ref) => {
                      const pMeta =
                        PLATFORM_META[ref.item.platform as keyof typeof PLATFORM_META] ??
                        PLATFORM_META.other;
                      const hasTime =
                        ref.chunk.start_seconds !== null && ref.chunk.start_seconds !== undefined;

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

                              <button
                                type="button"
                                className="truncate text-xs font-medium text-foreground hover:underline"
                                onClick={() => onOpenItem?.(ref.item.id)}
                                title={ref.item.title || ref.item.url}
                              >
                                {ref.item.title || ref.item.url}
                              </button>
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
    </div>
  );
}
