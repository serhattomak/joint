import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, type Window as AppWindow } from '@tauri-apps/api/window';

/*
 * Pencere kabuğu — Mac görünümlü, Windows alışkanlıklarını koruyan özel titlebar.
 *
 * Neden gerekli: `decorations: false` ile yerel başlık çubuğu kalkar; bu Windows'ta
 * beraberinde kenardan boyutlandırmayı da götürür (`resizable: true` olsa bile).
 * `ResizeHandles` o boşluğu `startResizeDragging` ile kapatır.
 *
 * Sürükleme Tauri'nin `data-tauri-drag-region` işaretiyle yapılır. Windows'ta bu
 * HTCAPTION'a gider; yani taşıma, yarı-ekran yapıştırma ve çift tıkla büyütme
 * yerel Windows davranışı olarak kalır.
 *
 * Kanıt tezgâhı uygulamayı tarayıcıda açar; Tauri IPC yokken bu bileşenler hiçbir
 * şey çağırmaz (aksi hâlde sayfa hatası üretirlerdi).
 */

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type ResizeDir = 'North' | 'NorthEast' | 'East' | 'SouthEast' | 'South' | 'SouthWest' | 'West' | 'NorthWest';

/** Mac trafik ışığı renkleri — kimlik bunlarda; tema token'ı değil, pencere kabuğu. */
const MAC_DOT = {
  minimize: '#febc2e',
  maximize: '#28c840',
  close: '#ff5f57',
} as const;

/** Tek erişim noktası: `getCurrentWindow()` tarayıcıda fırlatır, bu yüzden guard'lı. */
const runOnWindow = (fn: (w: AppWindow) => Promise<void>): void => {
  if (!inTauri) return;
  void fn(getCurrentWindow()).catch(() => undefined);
};

interface DotProps {
  label: string;
  color: string;
  dimmed: boolean;
  revealed: boolean;
  icon: ReactNode;
  onClick: () => void;
}

function Dot({ label, color, dimmed, revealed, icon, onClick }: DotProps) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-6 place-items-center">
      <span
        aria-hidden
        className="grid size-3 place-items-center rounded-full transition-[background-color,filter] duration-150 ease-paper group-hover:brightness-90"
        style={{ backgroundColor: dimmed ? 'var(--color-input)' : color }}
      >
        <span
          className={`text-black/55 transition-opacity duration-150 ease-paper ${revealed ? 'opacity-100' : 'opacity-0'}`}
        >
          {icon}
        </span>
      </span>
    </button>
  );
}

/*
 * Kapat / Küçült / Büyüt — sağda (Windows yeri), ama Mac trafik ışığı görünümünde.
 * Pencere odak dışındayken ışıklar grileşir; grup üzerine gelince glifler belirir.
 */
export function WindowControls() {
  const [focused, setFocused] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    const w = getCurrentWindow();
    let alive = true;
    const syncMaximized = (): void => {
      void w
        .isMaximized()
        .then((m) => {
          if (alive) setMaximized(m);
        })
        .catch(() => undefined);
    };
    const pending: Promise<UnlistenFn>[] = [
      w.onFocusChanged(({ payload }) => {
        if (alive) setFocused(payload);
      }),
      w.onResized(syncMaximized),
    ];
    syncMaximized();
    return () => {
      alive = false;
      void Promise.all(pending)
        .then((fns) => {
          for (const fn of fns) fn();
        })
        .catch(() => undefined);
    };
  }, []);

  const reveal = revealed && focused;

  return (
    <div
      className="group flex shrink-0 items-center gap-1 border-l border-border pl-3"
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
    >
      <Dot
        label="Küçült"
        color={MAC_DOT.minimize}
        dimmed={!focused}
        revealed={reveal}
        icon={<Minus className="size-2" strokeWidth={3} />}
        onClick={() => runOnWindow((w) => w.minimize())}
      />
      <Dot
        label={maximized ? 'Geri yükle' : 'Büyüt'}
        color={MAC_DOT.maximize}
        dimmed={!focused}
        revealed={reveal}
        icon={
          maximized ? <Copy className="size-2" strokeWidth={3} /> : <Square className="size-2" strokeWidth={3} />
        }
        onClick={() => runOnWindow((w) => w.toggleMaximize())}
      />
      <Dot
        label="Kapat"
        color={MAC_DOT.close}
        dimmed={!focused}
        revealed={reveal}
        icon={<X className="size-2" strokeWidth={3} />}
        onClick={() => runOnWindow((w) => w.close())}
      />
    </div>
  );
}

/*
 * Görünmez kenar/köşe tutamaçları. `decorations: false` Windows'ta yerel boyutlandırma
 * kenarını kaldırdığı için bu şart; aksi hâlde pencere yeniden boyutlandırılamaz
 * (PRODUCT.md yarı-ekrana yapıştırmayı birinci sınıf kullanım sayar).
 */
const EDGES: ReadonlyArray<{ dir: ResizeDir; at: string }> = [
  { dir: 'North', at: 'top-0 left-2 right-2 h-1 cursor-ns-resize' },
  { dir: 'South', at: 'bottom-0 left-2 right-2 h-1 cursor-ns-resize' },
  { dir: 'West', at: 'left-0 top-2 bottom-2 w-1 cursor-ew-resize' },
  { dir: 'East', at: 'right-0 top-2 bottom-2 w-1 cursor-ew-resize' },
  { dir: 'NorthWest', at: 'top-0 left-0 size-2 cursor-nwse-resize' },
  { dir: 'NorthEast', at: 'top-0 right-0 size-2 cursor-nesw-resize' },
  { dir: 'SouthWest', at: 'bottom-0 left-0 size-2 cursor-nesw-resize' },
  { dir: 'SouthEast', at: 'bottom-0 right-0 size-2 cursor-nwse-resize' },
];

export function ResizeHandles() {
  if (!inTauri) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      {EDGES.map(({ dir, at }) => (
        <div
          key={dir}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            runOnWindow((w) => w.startResizeDragging(dir));
          }}
          className={`pointer-events-auto absolute ${at}`}
        />
      ))}
    </div>
  );
}
