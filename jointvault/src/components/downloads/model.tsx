import { Archive, FileCode, FileText, Film, Music, Package } from 'lucide-react';
import type { DownloadCategory, DownloadJob, DownloadStatus } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import type { TransferSort } from '@/lib/downloads';

export type RowStatus = 'active' | 'queued' | 'paused' | 'error' | 'done';
export type SortKey = TransferSort;

export interface BaseTransfer {
  key: string;
  id: string;
  title: string;
  source: string;
  engine: string;
  detail: string;
  status: RowStatus;
  progress: number;
  size: number;
  downloaded: number;
  speed: number;
  eta: number;
  speedText: string | null;
  etaText: string | null;
  path: string | null;
  convertedPath: string | null;
  createdAt: string;
  platform: string;
  category: DownloadCategory;
  error: string | null;
}

export interface TurboTransfer extends BaseTransfer {
  kind: 'turbo';
  job: DownloadJob;
}

export interface VaultTransfer extends BaseTransfer {
  kind: 'vault';
  item: Item;
}

export type Transfer = TurboTransfer | VaultTransfer;

export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'En yeni',
  oldest: 'En eski',
  name: 'Ad (A→Z)',
  size: 'Boyut',
};

export const CATEGORY_LABEL: Record<DownloadCategory, string> = {
  video: 'Video',
  audio: 'Ses',
  archive: 'Sıkıştırılmış',
  document: 'Belge',
  program: 'Program',
  other: 'Dosya',
};

export const TURBO_STATUS: Record<DownloadStatus, RowStatus> = {
  active: 'active',
  queued: 'queued',
  paused: 'paused',
  error: 'error',
  completed: 'done',
};

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' });

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return isToday(iso) ? TIME_FORMAT.format(d) : DATE_FORMAT.format(d);
}

export function shortSource(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '');
}

export function baseName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path;
}

export function categoryIcon(category: DownloadCategory) {
  switch (category) {
    case 'video':
      return <Film className="size-3.5" />;
    case 'audio':
      return <Music className="size-3.5" />;
    case 'archive':
      return <Archive className="size-3.5" />;
    case 'document':
      return <FileText className="size-3.5" />;
    case 'program':
      return <FileCode className="size-3.5" />;
    default:
      return <Package className="size-3.5" />;
  }
}
