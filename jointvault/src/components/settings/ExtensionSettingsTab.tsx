import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOpenTarget } from '@/lib/open-target';
import { writeClipboardText } from '@/lib/clipboard';

interface ExtensionInfo {
  dir: string;
  installed: boolean;
  lastSeen: number | null;
}

export function ExtensionSettingsTab() {
  const { open } = useOpenTarget();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [extension, setExtension] = useState<ExtensionInfo | null>(null);

  useEffect(() => {
    void invoke<string>('get_pairing_token')
      .then(setToken)
      .catch((e: unknown) => setTokenError(String(e)));
    void invoke<ExtensionInfo>('extension_info')
      .then(setExtension)
      .catch(() => setExtension(null));
  }, []);

  const copyToken = async (): Promise<void> => {
    const result = await writeClipboardText(token);
    setTokenError(result.ok ? null : result.error);
  };

  const runRegenToken = async (): Promise<void> => {
    try {
      const next = await invoke<string>('regenerate_pairing_token');
      setToken(next);
    } catch (e: unknown) {
      setTokenError(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 settings-card p-4">
        <span className="text-sm font-medium">Eşleşme anahtarı</span>
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
          <Button variant="outline" size="sm" onClick={() => setConfirmRegenOpen(true)}>
            Yenile
          </Button>
        </div>
        {tokenError && <p className="text-sm text-destructive">{tokenError}</p>}
        <p className="text-xs text-muted-foreground">
          {extension?.lastSeen ? (
            <>
              Eklenti bağlı — son temas:{' '}
              <span data-num>{new Date(extension.lastSeen).toLocaleString('tr-TR')}</span>
            </>
          ) : (
            'Eklenti bu kurulumda henüz bağlanmadı.'
          )}
        </p>
      </div>

      {/* Tarayıcı indirmelerini devralma (IDM'in "download takeover"ı). */}
      <div className="flex flex-col gap-2 settings-card p-4">
        <span className="text-sm font-medium">Tarayıcıdan indirme devralma</span>
        <p className="text-xs text-muted-foreground">
          Eklenti kuruluyken tarayıcıda başlatılan indirmeler JointVault'a devredilir: tarayıcının
          indirmesi iptal edilir ve dosya çok kanallı motorla, kaldığı yerden devam edebilen bir
          indirmeyle iner. Adresin <span className="font-mono text-micro">Referer</span>'i ve
          çerezleri de taşınır, böylece oturum gerektiren bağlantılar da çalışır.
        </p>
        <p className="text-xs text-muted-foreground">
          Hangi uzantıların devralınacağını ve devralmayı açıp kapatmayı eklentinin kendi
          penceresinden ayarlarsın. Uygulama kapalıyken devralma olmaz; indirme tarayıcıda iner.
        </p>
      </div>

      <div className="flex flex-col gap-3 settings-card p-4">
        <span className="text-sm font-medium">Eklentiyi kur</span>
        <p className="text-xs text-muted-foreground">
          X yer işaretleri, Instagram kaydedilenler ve YouTube oynatma listeleri yalnızca eklentiyle
          içe aktarılır. Kurulum bir kez yapılır.
        </p>
        <ol className="list-inside list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground">
          <li>Eklenti klasörünü aç (aşağıdaki düğme).</li>
          <li>
            Chrome'da <span className="font-mono text-foreground">chrome://extensions</span> adresini
            aç, sağ üstten <span className="text-foreground">Geliştirici modu</span>'nu aç.
          </li>
          <li>
            <span className="text-foreground">Paketlenmemiş öğe yükle</span> → açılan eklenti klasörünü
            seç.
          </li>
          <li>Eklenti penceresine yukarıdaki eşleşme anahtarını yapıştır.</li>
        </ol>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!extension?.installed}
            onClick={() => extension && open(extension.dir)}
          >
            Eklenti klasörünü aç
          </Button>
          {extension && !extension.installed && (
            <span className="text-xs text-muted-foreground">
              Bu derlemede eklenti klasörü yok — kurulum paketinden çalıştır.
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRegenOpen}
        onOpenChange={setConfirmRegenOpen}
        title="Eşleşme anahtarı yenilensin mi?"
        description="Eski anahtarla eşleşmiş tarayıcı eklentileri bağlantıyı kaybeder. Eklenti ayarlarına yeni anahtarı girmen gerekir."
        confirmLabel="Yenile"
        onConfirm={() => void runRegenToken()}
      />
    </div>
  );
}
