import React, { useState } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Globe,
  ImageIcon,
  Loader2,
  Maximize2,
  RefreshCw,
  User,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Item, ItemArticle } from '@/lib/db/types';
import { openExternal } from '@/lib/external';
import { cacheArticleImages, parseArticleImages, parseArticleVideos } from '@/lib/scraper';

interface ReaderViewProps {
  item: Item;
  article: ItemArticle | null;
  loading?: boolean;
  onScrape: () => Promise<void>;
}

export function ReaderView({ item, article, loading = false, onScrape }: ReaderViewProps) {
  const [copied, setCopied] = useState(false);
  const [cachingImages, setCachingImages] = useState(false);
  const [cacheSuccess, setCacheSuccess] = useState(false);
  const [fullScreenOpen, setFullScreenOpen] = useState(false);
  const [fontSerif, setFontSerif] = useState(false);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');

  const images = parseArticleImages(article);
  const videos = parseArticleVideos(article);

  const handleCopyText = async () => {
    if (!article) return;
    try {
      await navigator.clipboard.writeText(
        `${article.title || item.title || ''}\n\n${article.content_text}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Kopyalanamadı:', e);
    }
  };

  const handleCacheImages = async () => {
    if (!article || images.length === 0 || cachingImages) return;
    setCachingImages(true);
    try {
      const urls = images.map((i) => i.url);
      await cacheArticleImages(item.id, urls);
      setCacheSuccess(true);
      setTimeout(() => setCacheSuccess(false), 3000);
    } catch (e) {
      console.error('Görseller önbelleklenemedi:', e);
    } finally {
      setCachingImages(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Sayfa İçeriği Kazınıyor…</span>
          <span className="text-2xs text-muted-foreground">
            Web sayfasına gidiliyor, metinler, görseller ve videolar temizleniyor.
          </span>
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-sm border border-dashed border-border bg-card/30 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BookOpen className="size-6" />
        </div>
        <div className="flex max-w-sm flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">İçerik Henüz Çekilmedi</h3>
          <p className="text-2xs leading-relaxed text-muted-foreground">
            Bu yer iminin gerçek web sayfasına gidip makale metnini, başlıklarını, görsellerini ve videolarını okuyucu modunda saklayabilirsiniz.
          </p>
        </div>
        <Button onClick={() => void onScrape()} size="sm" className="gap-2 font-medium">
          <RefreshCw className="size-3.5" />
          <span>Sayfa İçeriğini Çek (Scrape Et)</span>
        </Button>
      </div>
    );
  }

  const renderContent = (isModal = false) => (
    <article
      className={`flex flex-col gap-5 ${
        fontSerif ? 'font-serif' : 'font-sans'
      } ${
        fontSize === 'sm'
          ? 'text-xs'
          : fontSize === 'lg'
          ? 'text-base'
          : 'text-sm'
      }`}
    >
      {/* Header Info */}
      <header className="flex flex-col gap-2.5 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {article.site_name && (
            <Badge variant="outline" className="gap-1 text-2xs font-normal">
              <Globe className="size-3" />
              <span>{article.site_name}</span>
            </Badge>
          )}
          {article.reading_time_mins > 0 && (
            <Badge variant="secondary" className="gap-1 text-2xs font-normal">
              <Clock className="size-3" />
              <span>{article.reading_time_mins} dk okuma</span>
            </Badge>
          )}
          {article.author && (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <User className="size-3" />
              <span>{article.author}</span>
            </span>
          )}
          {article.published_at && (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Calendar className="size-3" />
              <span>{new Date(article.published_at).toLocaleDateString('tr-TR')}</span>
            </span>
          )}
        </div>

        <h1 className="text-lg font-bold leading-tight tracking-tight text-foreground sm:text-xl">
          {article.title || item.title || 'Başlıksız Makale'}
        </h1>

        <div className="flex items-center justify-between gap-2 pt-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              void openExternal(item.url);
            }}
            className="flex items-center gap-1 text-2xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" />
            <span className="truncate max-w-[280px]">{item.url}</span>
          </a>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onScrape()}
              className="h-7 px-2 text-2xs gap-1"
              title="İçeriği web sayfasından tekrar çek"
            >
              <RefreshCw className="size-3" />
              <span>Yenile</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyText()}
              className="h-7 px-2 text-2xs gap-1"
              title="Metni kopyala"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
            </Button>
            {!isModal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFullScreenOpen(true)}
                className="h-7 px-2 text-2xs gap-1"
                title="Tam ekranda dikkat dağıtmadan oku"
              >
                <Maximize2 className="size-3" />
                <span>Genişlet</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Lead Image */}
      {article.lead_image && (
        <div className="relative overflow-hidden rounded-md border border-border/80 bg-muted/20">
          <img
            src={article.lead_image}
            alt={article.title || 'Makale Görseli'}
            className="max-h-80 w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}

      {/* Formatted Article Body */}
      <div className="prose prose-invert max-w-none space-y-3.5 leading-relaxed text-foreground/90">
        <MarkdownRenderer content={article.content_markdown || article.content_text} />
      </div>

      {/* Media Galleries (Images & Videos) */}
      {(images.length > 0 || videos.length > 0) && (
        <section className="mt-6 flex flex-col gap-4 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sayfadaki Medyalar ({images.length} Görsel, {videos.length} Video)
              </h4>
            </div>

            {images.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={cachingImages || cacheSuccess}
                onClick={() => void handleCacheImages()}
                className="h-6 gap-1 px-2 text-3xs"
              >
                {cachingImages ? (
                  <Loader2 className="size-2.5 animate-spin" />
                ) : cacheSuccess ? (
                  <Check className="size-2.5 text-emerald-500" />
                ) : (
                  <Download className="size-2.5" />
                )}
                <span>{cacheSuccess ? 'İndirildi' : 'Çevrimdışı İndir'}</span>
              </Button>
            )}
          </div>

          {/* Videos */}
          {videos.length > 0 && (
            <div className="flex flex-col gap-2">
              {videos.map((vid, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-sm border border-border bg-card p-2.5"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Video className="size-4 shrink-0 text-red-500" />
                    <span className="truncate text-xs font-medium text-foreground">
                      {vid.caption || vid.alt || `Video #${idx + 1}`}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-2xs gap-1"
                    onClick={() => void openExternal(vid.url)}
                  >
                    <ExternalLink className="size-3" />
                    <span>Videoyu Aç</span>
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Images Grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.slice(0, 12).map((img, idx) => (
                <div
                  key={idx}
                  className="group relative aspect-video overflow-hidden rounded-xs border border-border bg-muted/30"
                >
                  <img
                    src={img.url}
                    alt={img.alt || `Görsel #${idx + 1}`}
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).parentElement?.remove();
                    }}
                  />
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      void openExternal(img.url);
                    }}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Eye className="size-4 text-white" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </article>
  );

  return (
    <>
      <div className="flex flex-col gap-4">{renderContent(false)}</div>

      {/* Fullscreen Reader Modal */}
      <Dialog open={fullScreenOpen} onOpenChange={setFullScreenOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto bg-background/95 backdrop-blur-md p-6 sm:p-10">
          <DialogHeader className="mb-4 flex flex-row items-center justify-between border-b border-border/60 pb-3">
            <DialogTitle className="text-sm font-medium text-muted-foreground">
              Dikkat Dağıtmayan Okuma Modu
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFontSerif(!fontSerif)}
                className="h-7 px-2 text-2xs"
              >
                {fontSerif ? 'Sans-serif' : 'Serif'}
              </Button>
              <div className="flex items-center rounded-sm border border-border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setFontSize('sm')}
                  className={`px-2 py-0.5 text-2xs rounded-xs ${
                    fontSize === 'sm' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => setFontSize('base')}
                  className={`px-2 py-0.5 text-2xs rounded-xs ${
                    fontSize === 'base' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => setFontSize('lg')}
                  className={`px-2 py-0.5 text-2xs rounded-xs ${
                    fontSize === 'lg' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  A+
                </button>
              </div>
            </div>
          </DialogHeader>

          <div className="mx-auto max-w-2xl py-4">{renderContent(true)}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Lightweight, zero-dependency structural Markdown renderer for articles.
 */
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const blocks = content.split(/\n\s*\n+/);

  return (
    <>
      {blocks.map((block, idx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Headings
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={idx} className="mt-4 text-base font-semibold text-foreground">
              {trimmed.replace(/^###\s+/, '')}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={idx} className="mt-5 text-lg font-semibold text-foreground">
              {trimmed.replace(/^##\s+/, '')}
            </h2>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1 key={idx} className="mt-6 text-xl font-bold text-foreground">
              {trimmed.replace(/^#\s+/, '')}
            </h1>
          );
        }

        // Blockquotes
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-primary pl-3.5 italic text-muted-foreground my-3"
            >
              {trimmed.replace(/^>\s+/, '')}
            </blockquote>
          );
        }

        // List item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const items = trimmed.split('\n').filter((l) => l.trim().startsWith('- ') || l.trim().startsWith('* '));
          return (
            <ul key={idx} className="my-2 list-disc pl-5 space-y-1 text-foreground/90">
              {items.map((it, i) => (
                <li key={i}>{it.replace(/^[-*]\s+/, '')}</li>
              ))}
            </ul>
          );
        }

        // Regular paragraph with potential bold and links
        return (
          <p key={idx} className="text-foreground/90 leading-relaxed">
            {formatInlineText(trimmed)}
          </p>
        );
      })}
    </>
  );
}

function formatInlineText(text: string): React.ReactNode {
  // Simple bold and link matcher
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            void openExternal(linkMatch[2]);
          }}
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}
