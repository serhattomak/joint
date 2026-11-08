export const CLIPBOARD_WATCH_KEY = 'jv-clipboard-watch';

export function isWatchEnabled(): boolean {
  return localStorage.getItem(CLIPBOARD_WATCH_KEY) !== 'off';
}
