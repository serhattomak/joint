import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Theme = 'system' | 'dark' | 'light';

const KEY = 'jointvault-theme';

const ICONS = { system: Monitor, dark: Moon, light: Sun } as const;
const LABELS: Record<Theme, string> = {
  system: 'Sistem teması',
  dark: 'Koyu tema',
  light: 'Açık tema',
};
const ORDER: Theme[] = ['system', 'dark', 'light'];

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme | null) ?? 'system',
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const Icon = ICONS[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length])}
      aria-label={LABELS[theme]}
      title={LABELS[theme]}
    >
      <Icon />
    </Button>
  );
}
