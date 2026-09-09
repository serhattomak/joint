import { openUrl } from '@tauri-apps/plugin-opener';

/** Open a URL in the system browser. Falls back to window.open in dev-browser mode. */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
