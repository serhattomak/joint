import { invoke } from '@tauri-apps/api/core';

export type Platform = 'instagram' | 'tiktok' | 'x' | 'pinterest' | 'youtube' | 'other';

export interface Preview {
  title: string | null;
  thumbnail: string | null;
  site: string | null;
}

const isHost = (host: string, ...domains: string[]): boolean =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

// Pure + unit-testable. Subdomain-tolerant: mobile./www./m./vm. prefixes all match.
export function detectPlatform(raw: string): Platform {
  const input = raw.trim();
  if (!input) return 'other';
  let host: string;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
    host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return 'other';
  }
  if (!host) return 'other';
  if (isHost(host, 'instagram.com')) return 'instagram';
  if (isHost(host, 'tiktok.com')) return 'tiktok';
  if (isHost(host, 'x.com', 'twitter.com')) return 'x';
  if (isHost(host, 'pinterest.com', 'pin.it')) return 'pinterest';
  if (isHost(host, 'youtube.com', 'youtu.be', 'youtube-nocookie.com')) return 'youtube';
  return 'other';
}

// ponytail: dot classes must stay literal so Tailwind picks them up.
// Kartoteks mürekkep kodu: platform rengi mürekkebe batırılmış hâliyle kullanılır.
export const PLATFORM_META: Record<Platform, { label: string; dot: string }> = {
  instagram: { label: 'Instagram', dot: 'bg-src-instagram' },
  tiktok: { label: 'TikTok', dot: 'bg-src-tiktok' },
  x: { label: 'X', dot: 'bg-src-x' },
  pinterest: { label: 'Pinterest', dot: 'bg-src-pinterest' },
  youtube: { label: 'YouTube', dot: 'bg-src-youtube' },
  other: { label: 'Diğer', dot: 'bg-src-other' },
};

export const PLATFORM_ORDER: Platform[] = ['instagram', 'tiktok', 'x', 'pinterest', 'youtube', 'other'];

// Rust returns Err as string on failure — null keeps callers total.
export async function fetchPreview(url: string): Promise<Preview | null> {
  try {
    return await invoke<Preview | null>('fetch_preview', { url });
  } catch {
    return null;
  }
}
