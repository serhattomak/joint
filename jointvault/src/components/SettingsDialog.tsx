import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ThemeToggle';
import { QUALITY_OPTIONS, getDefaultQuality, setDefaultQuality, type DownloadQuality } from '@/lib/downloads';

type SettingsTab = 'view' | 'downloads' | 'extension';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageSize: number;
  pageSizes: readonly number[];
  onPageSizeChange: (n: number) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onOpenChange, pageSize, pageSizes, onPageSizeChange } = props;
  const [tab, setTab] = useState<SettingsTab>('view');
  // İndirme klasörü
  const [dir, setDir] = useState('');
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  // Eşleşme anahtarı
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirError(null);
    setTokenError(null);
    setQuality(getDefaultQuality());
    void invoke<string>('get_download_dir')
      .then(setDir)
      .catch((e: unknown) => setDirError(String(e)));
    void invoke<string>('get_pairing_token')
      .then(setToken)
      .catch((e: unknown) => setTokenError(String(e)));
  }, [open ]);

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

  const copyToken = async (): Promise<void> => {
    try {
      await writeText(token);
    } catch (e: unknown) {
      setTokenError(String(e));
    }
  };

  const regenToken = async (): Promise<void> => {
    if (!window.confirm('Eşleşme anahtarı yenilensin mi? Eklentiye yeniden girmen gerekir.')) return;
    try {
      const next = await invoke<string>('regenerate_pairing_token');
      setToken(next);
    } catch (e: unknown) {
      setTokenError(String(e));
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'view', label: 'Görünüm' },
    { id: 'downloads', label: 'İndirme' },
    { id: 'extension', label: 'Eklenti' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ayarlar</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1 border-b border-border pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-selected={tab === t.id}
              role="tab"
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === t.id
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'view' && (
          <div className="flex flex-col">
            <Row label="Tema">
              <ThemeToggle />
            </Row>
            <Row label="Sayfa başına">
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number.parseInt(e.target.value, 10))}
                aria-label="Sayfa başına"
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none"
              >
                {pageSizes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Row>
          </div>
        )}

        {tab === 'downloads' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm">İndirme klasörü</span>
              <div className="flex gap-2">
                <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="İndirme klasörü…" />
                <Button variant="outline" size="sm" onClick={() => void pickDir()}>
                  Seç
                </Button>
                <Button size="sm" onClick={() => void saveDir()} disabled={dirBusy || dir.trim().length === 0}>
                  {dirBusy ? '…' : 'Kaydet'}
                </Button>
              </div>
              {dirError && <p className="text-sm text-destructive">{dirError}</p>}
            </div>
            <Row label="Varsayılan ses kalitesi">
              <select
                value={quality}
                onChange={(e) => {
                  const q = e.target.value as DownloadQuality;
                  setQuality(q);
                  setDefaultQuality(q);
                }}
                aria-label="Varsayılan ses kalitesi"
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none"
              >
                {QUALITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
          </div>
        )}

        {tab === 'extension' && (
          <div className="flex flex-col gap-2">
            <span className="text-sm">Eşleşme anahtarı</span>
            <p className="text-xs text-muted-foreground">
              Tarayıcı eklentisine bir kez girilir; yenilersen eklentiye yeniden girmen gerekir.
            </p>
            <div className="flex gap-2">
              <Input value={showToken ? token : '•'.repeat(24)} readOnly className="font-mono" />
              <Button variant="outline" size="sm" onClick={() => setShowToken((s) => !s)}>
                {showToken ? 'Gizle' : 'Göster'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyToken()}>
                Kopyala
              </Button>
              <Button variant="outline" size="sm" onClick={() => void regenToken()}>
                Yenile
              </Button>
            </div>
            {tokenError && <p className="text-sm text-destructive">{tokenError}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
