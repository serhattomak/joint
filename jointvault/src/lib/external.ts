import { openUrl } from '@tauri-apps/plugin-opener';
import { isSafeExternalUrl } from './urls';

/** Open a URL in the system browser. Falls back to window.open in dev-browser mode. */
export async function openExternal(url: string): Promise<void> {
  // Kazınmış makale içeriğinden gelen linkler buraya düşer: şema doğrulanmadan
  // `file:` / `javascript:` sistem kabuğuna geçmemeli.
  if (!isSafeExternalUrl(url)) return;
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
