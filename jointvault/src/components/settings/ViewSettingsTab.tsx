import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CLIPBOARD_WATCH_KEY, isWatchEnabled } from '@/components/ClipboardWatcher';

interface ViewSettingsTabProps {
  pageSize: number;
  pageSizes: readonly number[];
  onPageSizeChange: (n: number) => void;
  onReplayTour: () => void;
}

export function ViewSettingsTab({
  pageSize,
  pageSizes,
  onPageSizeChange,
  onReplayTour,
}: ViewSettingsTabProps) {
  const [watch, setWatch] = useState(() => isWatchEnabled());
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<boolean>('get_launch_at_startup')
      .then(setLaunchAtStartup)
      .catch((e: unknown) => setAutostartError(String(e)));
  }, []);

  const handleWatchToggle = (next: boolean): void => {
    window.localStorage.setItem(CLIPBOARD_WATCH_KEY, String(next));
    setWatch(next);
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div className="settings-card flex flex-col divide-y divide-border/70 p-4">
      <SettingRow label="Tema" htmlFor="theme-toggle">
        <ThemeToggle />
      </SettingRow>
      <SettingRow label="Sayfa başına kayıt" htmlFor="set-pagesize">
        <Select
          label="Sayfa boyutu"
          className="w-28"
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
          options={pageSizes.map((n) => ({ value: String(n), label: `${n} kayıt` }))}
        />
      </SettingRow>
      <SettingRow
        label="Panoyu otomatik izle"
        hint="Pano değiştikçe algılar, yakala çubuğuna hazırlar."
        htmlFor="set-watch"
      >
        <Switch checked={watch} onCheckedChange={handleWatchToggle} aria-labelledby="set-watch" />
      </SettingRow>
      <SettingRow
        label="Windows açılışında başlat"
        hint={
          autostartError ? (
            <span className="text-destructive">{autostartError}</span>
          ) : (
            'Oturum açtığında JointVault çekmecede gizli başlar; pencereyi çekmeceden açarsın.'
          )
        }
        htmlFor="set-autostart"
      >
        <Switch
          checked={launchAtStartup}
          onCheckedChange={(checked) => {
            setLaunchAtStartup(checked);
            setAutostartError(null);
            void invoke<boolean>('set_launch_at_startup', { enabled: checked })
              .then(setLaunchAtStartup)
              .catch((e: unknown) => {
                setLaunchAtStartup(!checked);
                setAutostartError(String(e));
              });
          }}
          aria-labelledby="set-autostart"
        />
      </SettingRow>
      <SettingRow
        label="Hızlı başlangıç turu"
        hint="Klavye kısayolları ve temel kavramları gösteren karşılama turunu yeniden açar."
      >
        <Button variant="outline" size="sm" onClick={onReplayTour}>
          Turu Başlat
        </Button>
      </SettingRow>
    </div>
  );
}
