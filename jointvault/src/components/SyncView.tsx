import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FolderDown,
  Info,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Tv,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageSurface } from '@/components/ui/page-surface';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { openExternal } from '@/lib/external';
import {
  BROWSERS,
  checkBrowserAvailable,
  clearCookiesFile,
  downloadAndProcessScannedItem,
  getSyncConfig,
  hasCookiesFile,
  requestNotificationPermission,
  saveSyncConfig,
  scanPlatformSaved,
  sendSyncNotification,
  uploadCookies,
  type SyncConfig,
  type SyncScannedItem,
} from '@/lib/sync';

interface SyncViewProps {
  onSyncDone?: () => void;
}

const BROWSER_OPTIONS: SelectOption[] = BROWSERS.map((b) => ({
  value: b.id,
  label: b.name,
}));

const BROWSER_OVERRIDE_OPTIONS: SelectOption[] = [
  { value: 'default', label: 'Varsayılan Tarayıcıyı Kullan' },
  ...BROWSER_OPTIONS,
];

const YOUTUBE_SOURCE_OPTIONS: SelectOption[] = [
  { value: 'WL', label: 'Daha Sonra İzle (Watch Later)' },
  { value: 'LL', label: 'Beğenilen Videolar (Liked Videos)' },
  { value: 'custom', label: 'Özel Oynatma Listesi URL' },
];

export function SyncView({ onSyncDone }: SyncViewProps) {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [browserOk, setBrowserOk] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<SyncScannedItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<'all' | 'x' | 'instagram' | 'youtube'>('all');
  const [itemSteps, setItemSteps] = useState<Record<string, string>>({});
  const [batchActive, setBatchActive] = useState(false);
  const [customYtUrl, setCustomYtUrl] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestNotificationPermission();
    void hasCookiesFile().then(setHasCookies);
    const unlistenCookies = listen('cookies-updated', () => {
      setHasCookies(true);
    });

    const unlistenCollect = listen<{
      items: { url: string; title?: string | null; thumbnail?: string | null; site?: string | null }[];
    }>('x-sync-collect', (event) => {
      const payloadItems = event.payload?.items || [];
      if (!payloadItems.length) return;
      const newScanned: SyncScannedItem[] = payloadItems.map((p) => {
        const u = p.url.trim();
        const pSite =
          p.site ||
          (u.includes('x.com') || u.includes('twitter.com')
            ? 'x'
            : u.includes('instagram.com')
            ? 'instagram'
            : 'youtube');
        return {
          id: u.split('/').filter(Boolean).pop() || Math.random().toString(),
          url: u,
          title: p.title || null,
          thumbnail: p.thumbnail || null,
          duration: null,
          uploader: null,
          platform: pSite,
          timestamp: Date.now(),
        };
      });
      setItems((prev) => {
        const existingUrls = new Set(prev.map((i) => i.url));
        const toAdd = newScanned.filter((i) => !existingUrls.has(i.url));
        return [...toAdd, ...prev];
      });
    });

    void (async () => {
      try {
        const cfg = await getSyncConfig();
        setConfig(cfg);
        const ok = await checkBrowserAvailable(cfg.default_browser);
        setBrowserOk(ok);
        if (cfg.youtube_source !== 'WL' && cfg.youtube_source !== 'LL') {
          setCustomYtUrl(cfg.youtube_source);
        }
      } catch (e) {
        console.error('Config load failed:', e);
      }
    })();

    return () => {
      void unlistenCookies.then((fn) => fn());
      void unlistenCollect.then((fn) => fn());
    };
  }, []);

  const handleUploadCookieFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await uploadCookies(text);
      setHasCookies(true);
      alert('cookies.txt başarıyla yüklendi! Artık tarama yapabilirsiniz.');
    } catch (err) {
      alert('Dosya okunamadı: ' + (err instanceof Error ? err.message : err));
    }
  };

  const handleClearCookies = async () => {
    await clearCookiesFile();
    setHasCookies(false);
  };

  const handleBrowserChange = async (browser: string) => {
    if (!config) return;
    const updated = { ...config, default_browser: browser };
    setConfig(updated);
    const ok = await checkBrowserAvailable(browser);
    setBrowserOk(ok);
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    const payload = {
      ...config,
      youtube_source:
        config.youtube_source === 'custom' && customYtUrl.trim()
          ? customYtUrl.trim()
          : config.youtube_source,
    };
    await saveSyncConfig(payload);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleScanPlatform = async (platform: 'x' | 'instagram' | 'youtube') => {
    if (!config) return;
    if (platform === 'x') {
      await openExternal('https://x.com/i/bookmarks');
      alert(
        "X Yer İmleri (x.com/i/bookmarks) tarayıcınızda açıldı.\n\nLütfen açılan sekmede JointVault Collector eklentisini açıp 'Topla' butonuna tıklayın. Yer imleriniz otomatik olarak buraya aktarılacaktır."
      );
      return;
    }
    if (platform === 'instagram') {
      const url = config.instagram_url || 'https://www.instagram.com/saved/all-posts/';
      await openExternal(url);
      alert(
        "Instagram Kaydedilenler sayfası tarayıcınızda açıldı.\n\nLütfen açılan sekmede JointVault Collector eklentisini açıp 'Topla' butonuna tıklayın. Kayıtlarınız otomatik olarak buraya aktarılacaktır."
      );
      return;
    }

    setScanning((prev) => ({ ...prev, [platform]: true }));
    try {
      const browser =
        config.youtube_browser || config.default_browser;

      const customUrl =
        config.youtube_source === 'custom'
          ? customYtUrl
          : config.youtube_source;

      const scanned = await scanPlatformSaved('youtube', {
        browser,
        limit: config.batch_limit,
        customUrl,
      });

      setItems((prev) => {
        const other = prev.filter((it) => it.platform.toLowerCase() !== 'youtube');
        return [...scanned, ...other];
      });

      // Update last sync
      const nowIso = new Date().toISOString();
      const updated = {
        ...config,
        last_sync_youtube: nowIso,
      };
      setConfig(updated);
      void saveSyncConfig(updated);
    } catch (e) {
      alert(`Tarama hatası (youtube): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const handleScanAll = async () => {
    if (!config) return;
    if (config.youtube_enabled) void handleScanPlatform('youtube');
    if (config.x_enabled || config.instagram_enabled) {
      alert(
        "YouTube listesi taranıyor.\n\nX ve Instagram yer imleri tarayıcı oturumu gerektirdiğinden, tarayıcınızda ilgili sayfaları açıp JointVault Collector eklentisindeki 'Topla' butonuna basarak aktarabilirsiniz."
      );
    }
  };

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    return items.filter((it) => it.platform.toLowerCase() === activeFilter);
  }, [items, activeFilter]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((it) => it.id)));
    }
  };

  const handleDownloadItem = async (item: SyncScannedItem) => {
    if (!config) return;
    const browser =
      item.platform === 'x' && config.x_browser
        ? config.x_browser
        : item.platform === 'instagram' && config.instagram_browser
        ? config.instagram_browser
        : item.platform === 'youtube' && config.youtube_browser
        ? config.youtube_browser
        : config.default_browser;

    setItemSteps((prev) => ({ ...prev, [item.id]: 'Başlatılıyor…' }));
    const res = await downloadAndProcessScannedItem(
      item,
      browser,
      undefined,
      config.auto_ai_pipeline,
      (step) => setItemSteps((prev) => ({ ...prev, [item.id]: step })),
    );

    if (res.success) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, inDb: true, downloadStatus: 'done', localPath: res.localPath }
            : it,
        ),
      );
      setItemSteps((prev) => ({ ...prev, [item.id]: 'Tamamlandı' }));
      onSyncDone?.();
    } else {
      setItemSteps((prev) => ({ ...prev, [item.id]: `Hata: ${res.error}` }));
    }
  };

  const handleBatchDownload = async (targetItems: SyncScannedItem[]) => {
    if (!config || batchActive) return;
    setBatchActive(true);
    let successCount = 0;

    for (const item of targetItems) {
      if (item.downloadStatus === 'done') continue;
      const browser =
        item.platform === 'x' && config.x_browser
          ? config.x_browser
          : item.platform === 'instagram' && config.instagram_browser
          ? config.instagram_browser
          : item.platform === 'youtube' && config.youtube_browser
          ? config.youtube_browser
          : config.default_browser;

      setItemSteps((prev) => ({ ...prev, [item.id]: 'Kuyrukta…' }));
      const res = await downloadAndProcessScannedItem(
        item,
        browser,
        undefined,
        config.auto_ai_pipeline,
        (step) => setItemSteps((prev) => ({ ...prev, [item.id]: step })),
      );

      if (res.success) {
        successCount++;
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, inDb: true, downloadStatus: 'done', localPath: res.localPath }
              : it,
          ),
        );
        setItemSteps((prev) => ({ ...prev, [item.id]: 'Tamamlandı' }));
      } else {
        setItemSteps((prev) => ({ ...prev, [item.id]: `Hata: ${res.error}` }));
      }
    }

    setBatchActive(false);
    onSyncDone?.();
    if (successCount > 0) {
      sendSyncNotification(
        'JointVault Eşitleme Tamamlandı',
        `${successCount} yeni kayıt başarıyla indirildi ve yapay zekâ ile indekslendi.`,
      );
    }
  };

  if (!config) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-primary" />
        <span>Eşitleme modülü yükleniyor…</span>
      </div>
    );
  }

  const isAnyScanning = Object.values(scanning).some(Boolean);
  const pendingItems = filteredItems.filter((i) => i.downloadStatus !== 'done');
  const selectedItemsToDownload = filteredItems.filter(
    (i) => selectedIds.has(i.id) && i.downloadStatus !== 'done',
  );

  return (
    <PageSurface
      icon={<RefreshCw strokeWidth={2.2} />}
      title="Eşitleme Merkezi"
      description="Instagram, X (Twitter) ve YouTube'daki kayıtlarınızı tarayıcı oturumunuzla doğrudan diske indirin ve yerel AI ile etiketleyin."
      width="6xl"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void handleSaveConfig()}>
            <Save />
            <span>{savedSuccess ? 'Kaydedildi ✓' : 'Ayarları Kaydet'}</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void handleScanAll()}
            disabled={isAnyScanning}
          >
            {isAnyScanning ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            <span>Tümünü Tara</span>
          </Button>
        </>
      }
    >

      {/* Hidden file input for cookies.txt upload */}
      <input
        type="file"
        accept=".txt"
        ref={fileInputRef}
        className="hidden"
        onChange={(e) => void handleUploadCookieFile(e)}
      />

      {/* Bölümler arası ritim — PageSurface gövdesi kendi boşluğunu vermez. */}
      <div className="flex flex-col gap-6">
      {/* Cookie Status Banner */}
      <div className="settings-card flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-2.5">
          <KeyRound
            className={`mt-0.5 size-4 shrink-0 ${
              hasCookies ? 'text-emerald-500' : 'text-amber-500'
            }`}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-foreground">
              {hasCookies
                ? 'Oturum Çerezleri Aktif (cookies.txt devrede)'
                : 'Chrome Çerez Kilidi Uyarısı & Çözümü'}
            </span>
            <p className="text-2xs leading-relaxed text-muted-foreground">
              {hasCookies
                ? 'Aktarılan çerez dosyası başarıyla devrede; Chrome açık olsa bile kilitlenmeden doğrudan X, Instagram ve YouTube taranabilir.'
                : "Chrome açıkken çerez dosyasını kilitler. Aşmak için: Chrome'daki JointVault Collector eklentisini açıp '🔑 Çerezleri JointVault'a Aktar' butonuna tıklayın veya aşağıdaki 'cookies.txt Yükle' butonu ile dosya seçin."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          {hasCookies ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-7 gap-1 px-2 text-2xs"
              >
                <Upload className="size-3" />
                <span>Yenisini Yükle</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleClearCookies()}
                className="h-7 px-2 text-2xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3" />
                <span>Çerezleri Sil</span>
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 gap-1 px-2.5 text-2xs font-medium"
            >
              <Upload className="size-3" />
              <span>cookies.txt Yükle</span>
            </Button>
          )}
        </div>
      </div>

      {/* Global Config — Ayarlar'ın satır dili: etiket solda, kontrol sağda, hairline */}
      <section className="settings-card flex flex-col divide-y divide-border/70 px-4">
        <SettingRow
          label="Varsayılan tarayıcı"
          hint={
            browserOk
              ? 'Tarayıcı hazır; oturum çerezleri okunabilir.'
              : 'Profil klasörü bulunamadı veya varsayılan konumda değil.'
          }
        >
          <Select
            label="Tarayıcı Seçimi"
            className="w-44"
            value={config.default_browser}
            onValueChange={(val) => void handleBrowserChange(val)}
            options={BROWSER_OPTIONS}
          />
          {browserOk !== null && (
            <span
              className={`size-2.5 shrink-0 rounded-full ${browserOk ? 'bg-emerald-500' : 'bg-amber-500'}`}
              title={browserOk ? 'Tarayıcı profili bulundu' : 'Tarayıcı profili tespit edilemedi'}
            />
          )}
        </SettingRow>

        <SettingRow label="Tarama parti limiti" hint="Rate-limit koruması için önerilen: 50 kayıt.">
          <Input
            type="number"
            min={5}
            max={200}
            value={config.batch_limit}
            onChange={(e) =>
              setConfig({ ...config, batch_limit: Math.max(5, parseInt(e.target.value) || 50) })
            }
            className="h-8 w-24 text-sm"
          />
        </SettingRow>

        <SettingRow
          label="Otomatik AI analiz hattı"
          hint="Whisper transkripti, LLM özet & etiketleme ve BGE-M3 arama indekslemesi."
        >
          <Switch
            checked={config.auto_ai_pipeline}
            onCheckedChange={(checked) => setConfig({ ...config, auto_ai_pipeline: checked })}
          />
          <span className="text-xs font-medium text-muted-foreground">
            {config.auto_ai_pipeline ? 'Aktif' : 'Kapalı'}
          </span>
        </SettingRow>
      </section>

      {/* Platform Cards */}
      <section className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
        {/* X / Twitter */}
        <div className="settings-card flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-foreground">
                  𝕏
                </span>
                <div>
                  <h2 className="text-sm font-semibold">X (Twitter)</h2>
                  <p className="text-2xs text-muted-foreground">Yer İmleri (/i/bookmarks)</p>
                </div>
              </div>
              <Switch
                checked={config.x_enabled}
                onCheckedChange={(checked) => setConfig({ ...config, x_enabled: checked })}
              />
            </div>

            <div className="flex items-start gap-2 text-2xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <p className="leading-relaxed">
                <span className="font-semibold text-foreground">Eklenti ile toplama: </span>
                X yer imleri dinamik SPA korumalıdır; sayfayı açıp eklentideki <b>Topla</b> ile tüm yer
                imlerini tek tıkla buraya aktarabilirsin.
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Clock className="size-3 text-muted-foreground/60" />
              <span>
                Son tarama:{' '}
                {config.last_sync_x
                  ? new Date(config.last_sync_x).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Eklenti ile toplanır'}
              </span>
            </div>
          </div>

          <Button
            variant="default"
            size="sm"
            disabled={!config.x_enabled}
            onClick={() => void handleScanPlatform('x')}
            className="mt-4 w-full gap-1.5 font-medium"
          >
            <ExternalLink className="size-3.5" />
            <span>x.com/i/bookmarks Sayfasını Aç</span>
          </Button>
        </div>

        {/* Instagram */}
        <div className="settings-card flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-pink-500/10 text-sm font-semibold text-pink-500">
                  IG
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Instagram</h2>
                  <p className="text-2xs text-muted-foreground">Kayıtlar</p>
                </div>
              </div>
              <Switch
                checked={config.instagram_enabled}
                onCheckedChange={(checked) => setConfig({ ...config, instagram_enabled: checked })}
              />
            </div>

            <div className="flex items-start gap-2 text-2xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <p className="leading-relaxed">
                <span className="font-semibold text-foreground">Eklenti ile toplama: </span>
                Instagram kaydedilenler tarayıcı korumalıdır; sayfayı açıp eklentideki <b>Topla</b> ile
                kayıtları tek tıkla buraya aktarabilirsin.
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Clock className="size-3 text-muted-foreground/60" />
              <span>
                Son tarama:{' '}
                {config.last_sync_instagram
                  ? new Date(config.last_sync_instagram).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Eklenti ile toplanır'}
              </span>
            </div>
          </div>

          <Button
            variant="default"
            size="sm"
            disabled={!config.instagram_enabled}
            onClick={() => void handleScanPlatform('instagram')}
            className="mt-4 w-full gap-1.5 font-medium"
          >
            <ExternalLink className="size-3.5" />
            <span>Instagram Kaydedilenleri Aç</span>
          </Button>
        </div>

        {/* YouTube */}
        <div className="settings-card flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500 [&_svg]:size-[18px]">
                  <Tv className="size-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">YouTube</h2>
                  <p className="text-2xs text-muted-foreground">Daha Sonra İzle / Beğenilenler</p>
                </div>
              </div>
              <Switch
                checked={config.youtube_enabled}
                onCheckedChange={(checked) => setConfig({ ...config, youtube_enabled: checked })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-2xs text-muted-foreground">Hedef Liste:</span>
              <Select
                label="YouTube Kaynağı"
                size="sm"
                value={
                  config.youtube_source === 'WL' || config.youtube_source === 'LL'
                    ? config.youtube_source
                    : 'custom'
                }
                onValueChange={(val) => setConfig({ ...config, youtube_source: val })}
                options={YOUTUBE_SOURCE_OPTIONS}
              />
              {config.youtube_source === 'custom' && (
                <Input
                  type="text"
                  placeholder="https://www.youtube.com/playlist?list=..."
                  value={customYtUrl}
                  onChange={(e) => setCustomYtUrl(e.target.value)}
                  className="mt-1 h-7 text-xs"
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-2xs text-muted-foreground">Özel Tarayıcı:</span>
              <Select
                label="YouTube Tarayıcı"
                size="sm"
                value={config.youtube_browser || 'default'}
                onValueChange={(val) =>
                  setConfig({ ...config, youtube_browser: val === 'default' ? null : val })
                }
                options={BROWSER_OVERRIDE_OPTIONS}
              />
            </div>

            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Clock className="size-3 text-muted-foreground/60" />
              <span>
                Son tarama:{' '}
                {config.last_sync_youtube
                  ? new Date(config.last_sync_youtube).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Henüz taranmadı'}
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={!config.youtube_enabled || scanning['youtube']}
            onClick={() => void handleScanPlatform('youtube')}
            className="mt-4 w-full gap-1.5"
          >
            {scanning['youtube'] ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span>{scanning['youtube'] ? 'Taranıyor…' : 'YouTube Videolarını Tara'}</span>
          </Button>
        </div>
      </section>

      {/* Scanned Items Results Table & Batch Actions */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1.5">
            <Layers className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Taranan Kayıtlar ({filteredItems.length})</h2>
            {items.length > 0 && (
              <Badge variant="outline" className="ml-1">
                {pendingItems.length} indirilmeyi bekliyor
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Buttons */}
            <div className="flex items-center rounded-lg border border-border p-0.5">
              {(['all', 'x', 'instagram', 'youtube'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ease-out ${
                    activeFilter === filter
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {filter === 'all'
                    ? 'Tümü'
                    : filter === 'x'
                    ? '𝕏'
                    : filter === 'instagram'
                    ? 'Instagram'
                    : 'YouTube'}
                </button>
              ))}
            </div>

            {/* Batch actions */}
            {selectedItemsToDownload.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={batchActive}
                onClick={() => void handleBatchDownload(selectedItemsToDownload)}
                className="gap-1.5"
              >
                <Download className="size-3.5" />
                <span>Seçilenleri İndir ({selectedItemsToDownload.length})</span>
              </Button>
            )}

            {pendingItems.length > 0 && (
              <Button
                variant="default"
                size="sm"
                disabled={batchActive}
                onClick={() => void handleBatchDownload(pendingItems)}
                className="gap-1.5"
              >
                {batchActive ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FolderDown className="size-3.5" />
                )}
                <span>Tümünü İndir ve AI ile İşle ({pendingItems.length})</span>
              </Button>
            )}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <RefreshCw className="size-8 stroke-[1.5] text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Henüz taranmış içerik yok</p>
            <p className="text-xs text-muted-foreground/70">
              Yukarıdaki platform kartlarından "Tara" butonuna basarak kaydedilenlerinizi listeleyebilirsiniz.
            </p>
          </div>
        ) : (
          <div className="settings-card flex flex-col divide-y divide-border/70 overflow-hidden">
            {/* Table Header */}
            <div className="flex items-center gap-3 bg-muted/40 px-3 py-2 text-2xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={
                  filteredItems.length > 0 && selectedIds.size === filteredItems.length
                }
                onChange={toggleSelectAll}
                className="size-3.5 cursor-pointer rounded-2xs border-border"
              />
              <span className="w-16">Kapak</span>
              <span className="flex-1">Başlık / Açıklama</span>
              <span className="w-24">Platform</span>
              <span className="w-36 text-center">Durum / AI</span>
              <span className="w-24 text-right">İşlem</span>
            </div>

            {/* Table Body */}
            {filteredItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const stepText = itemSteps[item.id];
              const isDone = item.downloadStatus === 'done' || stepText === 'Tamamlandı';

              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30 ${
                    isSelected ? 'bg-muted/40' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(item.id)}
                    className="size-3.5 cursor-pointer rounded-2xs border-border"
                  />

                  {/* Thumbnail */}
                  <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-muted">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.title || 'Medya'}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-2xs text-muted-foreground/50">Medya</span>
                    )}
                    {item.duration && (
                      <span className="absolute right-1 bottom-1 rounded-2xs bg-black/80 px-1 py-0.5 font-mono text-3xs text-white">
                        {Math.floor(item.duration / 60)}:
                        {String(Math.floor(item.duration % 60)).padStart(2, '0')}
                      </span>
                    )}
                  </div>

                  {/* Title & Info */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:text-primary hover:underline"
                    >
                      <span className="truncate">{item.title || item.url}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground/60" />
                    </a>
                    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                      {item.uploader && <span>{item.uploader}</span>}
                      {item.timestamp && (
                        <span>
                          {new Date(item.timestamp * 1000).toLocaleDateString('tr-TR')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Platform */}
                  <div className="w-24 shrink-0">
                    <Badge
                      variant="outline"
                      className={`uppercase text-3xs ${
                        item.platform.toLowerCase() === 'x'
                          ? 'border-neutral-500 text-foreground'
                          : item.platform.toLowerCase() === 'instagram'
                          ? 'border-pink-500/40 text-pink-500'
                          : 'border-red-500/40 text-red-500'
                      }`}
                    >
                      {item.platform}
                    </Badge>
                  </div>

                  {/* Status & Live AI Step */}
                  <div className="flex w-36 shrink-0 flex-col items-center gap-1 text-center">
                    {stepText ? (
                      <div className="flex items-center gap-1 text-2xs font-medium text-primary">
                        {stepText === 'Tamamlandı' ? (
                          <CheckCircle2 className="size-3 text-emerald-500" />
                        ) : stepText.startsWith('Hata') ? (
                          <AlertCircle className="size-3 text-destructive" />
                        ) : (
                          <Loader2 className="size-3 animate-spin text-primary" />
                        )}
                        <span className="truncate">{stepText}</span>
                      </div>
                    ) : isDone ? (
                      <Badge variant="default" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 className="size-2.5" />
                        <span>İndirildi & İndekslendi</span>
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-3xs">
                        Hazır
                      </Badge>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="flex w-24 shrink-0 justify-end">
                    {isDone ? (
                      <span className="font-mono text-2xs text-muted-foreground/70">
                        Diskte
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={Boolean(stepText && stepText !== 'Tamamlandı')}
                        onClick={() => void handleDownloadItem(item)}
                        className="h-7 px-2 text-2xs gap-1"
                      >
                        <Download className="size-3" />
                        <span>İndir</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </PageSurface>
  );
}
