export type Theme = 'system' | 'dark' | 'light';

const KEY = 'jointvault-theme';

export const THEME_ORDER: Theme[] = ['system', 'dark', 'light'];

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Sistem teması',
  dark: 'Koyu tema',
  light: 'Açık tema',
};

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === 'dark' || v === 'light' ? v : 'system';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  localStorage.setItem(KEY, theme);
}

export function cycleTheme(): Theme {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(getTheme()) + 1) % THEME_ORDER.length];
  applyTheme(next);
  window.dispatchEvent(new CustomEvent<Theme>('jv-theme', { detail: next }));
  return next;
}
