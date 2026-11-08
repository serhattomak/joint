import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useOpenTarget } from '@/lib/open-target';
import {
  QUALITY_OPTIONS,
  getDefaultQuality,
  setDefaultQuality,
  type DownloadQuality,
} from '@/lib/downloads';
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  getDownloadSettings,
  setDownloadSettings,
  type DownloadSettings,
} from '@/lib/turbo_download';
import {
  AFTER_COMPLETE_OPTIONS,
  CLOSE_OPTIONS,
  CONCURRENCY_OPTIONS,
  CONNECTION_OPTIONS,
  RETRY_OPTIONS,
  SPEED_LIMIT_OPTIONS,
} from './options';
import { StorageCard } from './StorageCard';

export function DownloadsSettingsTab() {
  const { reveal } = useOpenTarget();
  const [dir, setDir] = useState('');
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  const [dlSettings, setDlSettings] = useState<DownloadSettings>(DEFAULT_DOWNLOAD_SETTINGS);
  const [dlSettingsError, setDlSettingsError] = useState<string | null>(null);
  const [closeMode, setCloseMode] = useState('tray');

  useEffect(() => {
    void invoke<string>('get_download_dir')
      .then(setDir)
      .catch((e: unknown) => setDirError(String(e)));
    void getDownloadSettings()
      .then(setDlSettings)
      .catch((e: unknown) => setDlSettingsError(String(e)));
    void invoke<string>('get_close_behavior')
      .then((m) => setCloseMode(m === 'quit' ? 'quit' : 'tray'))
      .catch(() => setCloseMode('tray'));
  }, []);

  const pickDir = async (): Promise<void> => {
    setDirError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === 'string' && selected.length > 0) setDir(selected);
    } catch (e: unknown) {
      setDirError(String(e));
    }
  };

  const saveDir = async (): Promise<void> => {
    setDirBusy(true);
    setDirError(null);
    try {
      const next = await invoke<string>('set_download_dir', { path: dir });
      setDir(next);
    } catch (e: unknown) {
      setDirError(String(e));
    } finally {
      setDirBusy(false);
    }
  };

  /**
   * İndirme motoru ayarını yazar. İyimser güncelleme: anahtar anında oynar,
   * sonra backend'e yazılır ve motor sınırları aynı çağrıda tazelenir.
   */
  const updateDlSettings = async (patch: Partial<DownloadSettings>): Promise<void> => {
    const next = { ...dlSettings, ...patch };
    setDlSettings(next);
    setDlSettingsError(null);
    try {
      setDlSettings(await setDownloadSettings(next));
    } catch (e: unknown) {
      setDlSettingsError(String(e));
    }
  };

  return (
    <>
    <div className="settings-card flex flex-col divide-y divide-border/70 p-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="set-dir" className="text-sm font-medium">
          İndirme klasörü
        </label>
        <div className="flex gap-2">
          <Input
            id="set-dir"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="Örn: D:\İndirilenler\JointVault"
          />
          <Button variant="outline" size="sm" onClick={() => void pickDir()}>
            Seç…
          </Button>
          <Button size="sm" onClick={() => void saveDir()} disabled={dirBusy}>
            {dirBusy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          {/* Yolu açmak: klasör yoksa/silinmişse artık sessiz kalmaz, bildirim çıkar. */}
          <Button variant="outline" size="sm" onClick={() => reveal(dir)} disabled={!dir}>
            Aç
          </Button>
        </div>
        {dirError && <p className="text-sm text-destructive">{dirError}</p>}
      </div>
      <SettingRow
        label="Varsayılan kalite"
        hint="Kayıttan veya toplu indirmede hedef seçilmediğinde kullanılır."
        htmlFor="set-quality"
      >
        <Select
          label="Kalite"
          className="w-40"
          value={quality}
          onValueChange={(v) => {
            const q = v as DownloadQuality;
            setDefaultQuality(q);
            setQuality(q);
          }}
          options={QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </SettingRow>
      <SettingRow
        label="Eşzamanlı indirme"
        hint="Aynı anda indirilecek en fazla dosya sayısı. Fazlası kuyrukta bekler ve sırası gelince kendiliğinden başlar."
      >
        <Select
          label="Eşzamanlı indirme"
          className="w-40"
          value={String(dlSettings.max_concurrent)}
          onValueChange={(v) => void updateDlSettings({ max_concurrent: Number(v) })}
          options={CONCURRENCY_OPTIONS}
        />
      </SettingRow>
      <SettingRow
        label="Varsayılan kanal sayısı"
        hint="Dosya kaç parçaya bölünerek indirilir. Sunucu izin verirse kanallar boşa çıktıkça en büyük parça ikiye bölünür (dinamik parçalama)."
      >
        <Select
          label="Kanal sayısı"
          className="w-44"
          value={String(dlSettings.default_connections)}
          onValueChange={(v) => void updateDlSettings({ default_connections: Number(v) })}
          options={CONNECTION_OPTIONS}
        />
      </SettingRow>
      <SettingRow
        label="Toplam hız sınırı"
        hint="Tüm indirmelerin paylaştığı üst sınır. Yavaş bir bağlantıda arşivi gezerken bant genişliğini serbest bırakmak için kullanılır."
      >
        <Select
          label="Hız sınırı"
          className="w-40"
          value={String(dlSettings.speed_limit_bps)}
          onValueChange={(v) => void updateDlSettings({ speed_limit_bps: Number(v) })}
          options={SPEED_LIMIT_OPTIONS}
        />
      </SettingRow>
      <SettingRow
        label="Kategori klasörleri"
        hint="İndirilen dosya türüne göre alt klasöre ayrılır (Video, Ses, Sıkıştırılmış, Belge, Program, Diğer). Kapalıyken hepsi indirme köküne iner."
      >
        <Switch
          checked={dlSettings.category_folders}
          onCheckedChange={(checked) => void updateDlSettings({ category_folders: checked })}
        />
      </SettingRow>
      <SettingRow
        label="İndirme tamamlanınca"
        hint="İndirme bittiğinde ne yapılsın. IDM'deki 'start downloading now / open file' davranışının karşılığı."
      >
        <Select
          label="Tamamlanınca"
          className="w-40"
          value={dlSettings.after_complete}
          onValueChange={(v) =>
            void updateDlSettings({
              after_complete: v as DownloadSettings['after_complete'],
            })
          }
          options={AFTER_COMPLETE_OPTIONS}
        />
      </SettingRow>
      <SettingRow
        label="Hata sonrası yeniden deneme"
        hint="Bağlantı kopması gibi geçici hatalarda indirme kendiliğinden yeniden denenir ve kaldığı yerden sürer. Kalıcı hatalarda (ör. 404) denenmez."
      >
        <Select
          label="Yeniden deneme"
          className="w-40"
          value={String(dlSettings.retry_count)}
          onValueChange={(v) => void updateDlSettings({ retry_count: Number(v) })}
          options={RETRY_OPTIONS}
        />
      </SettingRow>
      <SettingRow
        label="Format seçince pencere kapansın"
        hint="Kapalıyken indirme başladıktan sonra format ekranı açık kalır (Kapat ile kapatırsın, indirme arka planda sürer). Açıkken ekran kendiliğinden kapanır."
      >
        <Switch
          checked={dlSettings.close_format_after_pick}
          onCheckedChange={(checked) => void updateDlSettings({ close_format_after_pick: checked })}
        />
      </SettingRow>
      <SettingRow
        label="Tarayıcıdan indirince pencere öne gelsin"
        hint="Tarayıcıda başlattığın indirmeyi uygulama devraldığında pencere öne gelir (IDM'in indirme penceresi gibi). Sayfanın kendiliğinden başlattığı indirmelerde de geçerlidir; rahatsız ederse kapat."
      >
        <Switch
          checked={dlSettings.raise_on_capture}
          onCheckedChange={(checked) => void updateDlSettings({ raise_on_capture: checked })}
        />
      </SettingRow>
      {dlSettingsError && <p className="pt-2 text-sm text-destructive">{dlSettingsError}</p>}
      <SettingRow
        label="Pencere kapatma davranışı"
        hint="Pencere [X] ile kapatıldığında uygulamanın ne yapacağını belirler."
        htmlFor="set-close-mode"
      >
        <Select
          label="Kapatma davranışı"
          className="w-64"
          value={closeMode}
          onValueChange={(v) => {
            setCloseMode(v);
            void invoke('set_close_behavior', { mode: v });
          }}
          options={CLOSE_OPTIONS}
        />
      </SettingRow>
    </div>
    <StorageCard />
    </>
  );
}
