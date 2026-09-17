import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, ScanSearch, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { listItems, removeItem } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { formatBytes } from '@/lib/downloads';
import { canonicalizeUrl } from '@/lib/urls';

interface UrlGroup {
  key: string;
  items: Item[];
}

interface FileGroup {
  hash: string;
  size: number;
  items: Item[];
}

interface DuplicatesViewProps {
  onDone: () => void;
}

export function DuplicatesView({ onDone }: DuplicatesViewProps) {
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [urlGroups, setUrlGroups] = useState<UrlGroup[]>([]);
  const [fileGroups, setFileGroups] = useState<FileGroup[]>([]);
  const [orphans, setOrphans] = useState<{ path: string; size: number }[]>([]);
  const [orphanChecked, setOrphanChecked] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Onay isteyen iş: hangi silme akışının onay beklediğini tek yerde tutar. */
  const [pendingRemove, setPendingRemove] = useState<'selected' | 'orphans' | null>(null);

  const scan = async (): Promise<void> => {
    setScanning(true);
    setError(null);
    try {
      const items = await listItems();
      // URL tekrarları: kanonik forma göre grupla.
      const byUrl = new Map<string, Item[]>();
      for (const it of items) {
        const key = canonicalizeUrl(it.url);
        const list = byUrl.get(key) ?? [];
        list.push(it);
        byUrl.set(key, list);
      }
      setUrlGroups(
        [...byUrl.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({ key, items: list })),
      );
      // Dosya tekrarları: DB'deki yolları Rust'a ver (boyut→hash).
      const paths = [...new Set(items.flatMap((it) => [it.local_path, it.converted_path]).filter((p): p is string => Boolean(p)))];
      if (paths.length > 0) {
        const groups = await invoke<{ hash: string; size: number; paths: string[] }[]>('scan_files', { paths });
        const pathToItem = new Map<string, Item>();
        for (const it of items) {
          if (it.local_path) pathToItem.set(it.local_path, it);
          if (it.converted_path) pathToItem.set(it.converted_path, it);
        }
        setFileGroups(
          groups.map((g) => ({
            hash: g.hash,
            size: g.size,
            items: g.paths.map((p) => pathToItem.get(p)).filter((it): it is Item => Boolean(it)),
          })).filter((g) => g.items.length > 1),
        );
      } else {
        setFileGroups([]);
      }
      // Yetimler: klasördeki DB-kayıtsız dosyalar.
      try {
        const dir = await invoke<string>('get_download_dir');
        const entries = await invoke<{ path: string; size: number }[]>('scan_dir', { dir });
        const known = new Set(
          items.flatMap((it) => [it.local_path, it.converted_path]).filter((p): p is string => Boolean(p)),
        );
        setOrphans(entries.filter((e) => !known.has(e.path)));
      } catch {
        setOrphans([]);
      }
      setOrphanChecked(new Set());
      setKeep({});
      setScanned(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Tarama başarısız.');
    } finally {
      setScanning(false);
    }
  };

  const removeSelected = async (): Promise<void> => {
    const victims = new Map<string, Item>();
    for (const g of urlGroups) {
      const keepId = keep[`u:${g.key}`] ?? g.items[0].id;
      for (const it of g.items) if (it.id !== keepId) victims.set(it.id, it);
    }
    for (const g of fileGroups) {
      const keepId = keep[`f:${g.hash}`] ?? g.items[0]?.id;
      for (const it of g.items) if (it.id !== keepId) victims.set(it.id, it);
    }
    if (victims.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      for (const it of victims.values()) {
        // ponytail: dosya silinemezse satır yine de silinir; hata raporda toplanırdı —
        // burada basit tutuldu: dosya hatası satırı engellemez.
        for (const p of [it.local_path, it.converted_path]) {
          if (!p) continue;
          try {
            await invoke('delete_file', { path: p });
          } catch {
            /* dosya yoksa/zaten silinmişse devam */
          }
        }
        await removeItem(it.id);
      }
      onDone();
      await scan();
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Silme başarısız.');
    } finally {
      setDeleting(false);
    }
  };

  const removeOrphans = async (): Promise<void> => {
    if (orphanChecked.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      for (const p of orphanChecked) {
        try {
          await invoke('delete_file', { path: p });
        } catch {
          /* kilitli/kayıp dosya atlanır */
        }
      }
      setOrphanChecked(new Set());
      await scan();
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Silme başarısız.');
    } finally {
      setDeleting(false);
    }
  };

  const totalVictims = (() => {    const s = new Set<string>();
    for (const g of urlGroups) {
      const keepId = keep[`u:${g.key}`] ?? g.items[0].id;
      for (const it of g.items) if (it.id !== keepId) s.add(it.id);
    }
    for (const g of fileGroups) {
      const keepId = keep[`f:${g.hash}`] ?? g.items[0]?.id;
      for (const it of g.items) if (it.id !== keepId) s.add(it.id);
    }
    return s.size;
  })();

  /* Onay yaprağının metni bekleyen işe göre türetilir — tek yaprak, iki iş. */
  const confirmCopy =
    pendingRemove === 'orphans'
      ? {
          title: `${orphanChecked.size} yetim dosya silinsin mi?`,
          description: 'Yalnızca diskten silinir; kayıtlar etkilenmez. Geri alınamaz.',
          label: `${orphanChecked.size} dosyayı sil`,
        }
      : {
          title: `${totalVictims} öğe silinsin mi?`,
          description: 'Kayıtlar ve diskteki dosyaları silinir. Geri alınamaz.',
          label: `${totalVictims} öğeyi sil`,
        };

  const groupBlock = (
    title: string,
    groups: { key: string; items: Item[]; meta: string }[],
    prefix: string,
  ): React.ReactNode => (
    <section className="flex flex-col gap-2">
      <h3 className="text-micro font-medium text-muted-foreground">
        {title} ({groups.length})
      </h3>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">Tekrar yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.key} className="rounded-xl border border-border bg-card p-3 shadow-card">
              <p className="mb-2 text-xs text-muted-foreground">{g.meta}</p>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`${prefix}:${g.key}`}
                      checked={(keep[`${prefix}:${g.key}`] ?? g.items[0].id) === it.id}
                      onChange={() => setKeep((k) => ({ ...k, [`${prefix}:${g.key}`]: it.id }))}
                      className="size-4 shrink-0 accent-primary"
                      aria-label="Tutulacak öğe"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.title || it.url}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{it.local_path ?? it.url}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Copy className="size-5 text-primary" strokeWidth={2} />
        <h2 className="text-title">Yinelenenler</h2>
        <div className="ml-auto flex items-center gap-2">
          {totalVictims > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setPendingRemove('selected')} disabled={deleting}>
              <Trash2 /> {totalVictims} öğeyi sil
            </Button>
          )}
          <Button onClick={() => void scan()} disabled={scanning || deleting}>
            <ScanSearch /> {scanning ? 'Taranıyor…' : scanned ? 'Tekrar tara' : 'Tara'}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!scanned && !scanning && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Aynı URL'li kayıtlar ve birebir aynı dosyalar bulunur. Tutulacak seçilir, gerisi silinir.
        </p>
      )}
      {groupBlock(
        'Aynı bağlantı',
        urlGroups.map((g) => ({ key: g.key, items: g.items, meta: g.items[0]?.url ?? g.key })),
        'u',
      )}
      {groupBlock(
        'Aynı dosya',
        fileGroups.map((g) => ({ key: g.hash.slice(0, 12), items: g.items, meta: `${formatBytes(g.size)} · ${g.hash.slice(0, 12)}…` })),
        'f',
      )}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-micro font-medium text-muted-foreground">
            Yetim dosyalar ({orphans.length})
          </h3>
          {orphanChecked.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setPendingRemove('orphans')} disabled={deleting}>
              <Trash2 /> {orphanChecked.size} dosyayı sil
            </Button>
          )}
        </div>
        {scanned && orphans.length === 0 ? (
          <p className="text-xs text-muted-foreground">Yetim yok.</p>
        ) : (
          <ul className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 shadow-card">
            {orphans.map((o) => (
              <li key={o.path} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={orphanChecked.has(o.path)}
                  onChange={() =>
                    setOrphanChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(o.path)) next.delete(o.path);
                      else next.add(o.path);
                      return next;
                    })
                  }
                  className="size-4 shrink-0 accent-primary"
                  aria-label="Silinecek yetim dosya"
                />
                <p className="min-w-0 flex-1 truncate font-mono text-xs">{o.path}</p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(o.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => {
          if (!o) setPendingRemove(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.label}
        onConfirm={() => void (pendingRemove === 'orphans' ? removeOrphans() : removeSelected())}
      />
    </div>
  );
}
