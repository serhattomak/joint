import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, cycleTheme, getTheme, THEME_LABELS, type Theme } from '@/lib/theme';

const ICONS = { system: Monitor, dark: Moon, light: Sun } as const;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // Palet gibi dış kaynaklar cycleTheme() çağırırsa ikon senkron kalsın.
  useEffect(() => {
    const onExternal = (e: Event): void => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener('jv-theme', onExternal);
    return () => window.removeEventListener('jv-theme', onExternal);
  }, []);

  const Icon = ICONS[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(cycleTheme())}
      aria-label={THEME_LABELS[theme]}
      title={THEME_LABELS[theme]}
    >
      <Icon />
    </Button>
  );
}
