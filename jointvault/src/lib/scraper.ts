import { invoke } from '@tauri-apps/api/core';
import { getItem, saveArticleForItem, updateItem } from './db/client';
import type { Item, ItemArticle, ScrapedMedia } from './db/types';
import { refreshItemIndex } from './ai';

export interface ScrapedArticleResult {
  url: string;
  title: string | null;
  description: string | null;
  author: string | null;
  published_at: string | null;
  content_text: string;
  content_markdown: string;
  reading_time_mins: number;
  lead_image: string | null;
  images: ScrapedMedia[];
  videos: ScrapedMedia[];
  site_name: string | null;
}

/**
 * Rust backend'ini kullanarak hedef URL'nin gerçek web içeriğini kazır.
 */
export async function scrapeWebContent(url: string): Promise<ScrapedArticleResult> {
  return await invoke<ScrapedArticleResult>('scrape_item_content', { url });
}

/**
 * Makaledeki görselleri yerel diske indirip çevrimdışı önbelleğe alır.
 */
export async function cacheArticleImages(itemId: string, urls: string[]): Promise<string[]> {
  if (!urls || urls.length === 0) return [];
  return await invoke<string[]>('cache_article_images', { itemId, urls });
}

/**
 * Tek bir öğenin web içeriğini kazır, `item_articles` tablosuna kaydeder,
 * başlık/kapak resmini tamamlar ve FTS5 tam metin arama indeksine ekler.
 */
export async function scrapeAndStoreArticle(itemId: string, url: string): Promise<ItemArticle> {
  const scraped = await scrapeWebContent(url);

  const article: ItemArticle = {
    item_id: itemId,
    title: scraped.title,
    content_text: scraped.content_text,
    content_markdown: scraped.content_markdown,
    author: scraped.author,
    published_at: scraped.published_at,
    reading_time_mins: scraped.reading_time_mins,
    lead_image: scraped.lead_image,
    images_json: JSON.stringify(scraped.images || []),
    videos_json: JSON.stringify(scraped.videos || []),
    site_name: scraped.site_name,
    scraped_at: new Date().toISOString(),
  };

  // 1. Veritabanına kaydet
  await saveArticleForItem(article);

  // 2. Önce eksik başlık/kapağı güncelle ki indeks bu başlıkla kurulsun.
  try {
    const currentItem = await getItem(itemId);
    if (currentItem) {
      const patch: { title?: string; thumbnail?: string } = {};
      const needsTitle =
        !currentItem.title ||
        currentItem.title.trim() === '' ||
        currentItem.title === currentItem.url;
      if (needsTitle && scraped.title) {
        patch.title = scraped.title;
      }
      if (!currentItem.thumbnail && scraped.lead_image) {
        patch.thumbnail = scraped.lead_image;
      }
      if (Object.keys(patch).length > 0) {
        await updateItem(itemId, patch);
      }
    }
  } catch (err) {
    console.warn('[scraper] Öğe başlık/görsel güncelleme uyarısı:', err);
  }

  // 3. TÜM chunk türlerini (meta+not+transcript+makale) birlikte kur ve indeksle.
  //    Ayrı yazım chunk'ları eziyordu; tek geçiş kullanılır. Tek refresh yeter
  //    (başlık artık güncel; ikinci bir tazeleme tetiklenmez).
  try {
    await refreshItemIndex(itemId);
  } catch (err) {
    console.warn('[scraper] indeksleme uyarısı:', err);
  }

  return article;
}

/**
 * Kayıtlı bir makalenin görsellerini ayrıştırır.
 */
export function parseArticleImages(
  article: { images_json?: string | null } | null,
): ScrapedMedia[] {
  if (!article || !article.images_json) return [];
  try {
    const parsed = JSON.parse(article.images_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Kayıtlı bir makalenin videolarını ayrıştırır.
 */
export function parseArticleVideos(
  article: { videos_json?: string | null } | null,
): ScrapedMedia[] {
  if (!article || !article.videos_json) return [];
  try {
    const parsed = JSON.parse(article.videos_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Çoklu öğelerin web içeriklerini sırayla kazır.
 */
export async function batchScrapeItems(
  items: Item[],
  onProgress?: (done: number, total: number, currentItem: Item) => void,
  delayMs = 300,
  isCancelled?: () => boolean,
): Promise<{ successCount: number; errorCount: number; failed: Item[] }> {
  let successCount = 0;
  let errorCount = 0;
  const failed: Item[] = [];
  const total = items.length;

  for (let i = 0; i < total; i++) {
    // İptal: kaldığı yerde durur; işlenmeyenler raporda eksik kalır.
    if (isCancelled?.()) break;
    const item = items[i];
    onProgress?.(i, total, item);
    try {
      await scrapeAndStoreArticle(item.id, item.url);
      successCount++;
    } catch (e) {
      console.error(`[batch-scraper] ${item.url} kazınamadı:`, e);
      errorCount++;
      failed.push(item);
    }
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  onProgress?.(successCount + errorCount, total, items[total - 1]);
  return { successCount, errorCount, failed };
}
