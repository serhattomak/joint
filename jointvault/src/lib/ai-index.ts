/**
 * İndeks tazelik abonesi.
 *
 * `vault-item-index-dirty` olayını dinler; aynı öğe için art arda istekleri
 * birleştirir (debounce) ve eşgüdümlü (concurrency 1) `refreshItemIndex` çağırır.
 *
 * Bağımlılık TEK YÖNLÜ: bu modül `ai.ts`'i import eder; `ai.ts` bunu import ETMEZ
 * (döngü yok). Abone `App.tsx`'te bir kez kurulur.
 */
import { refreshItemIndex } from './ai';

const DEBOUNCE_MS = 800;

const queue = new Set<string>();
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, DEBOUNCE_MS);
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.size > 0) {
      const [id] = queue;
      queue.delete(id);
      await refreshItemIndex(id).catch((err) => {
        console.warn('[ai-index] tazeleme başarısız', id, err);
      });
    }
  } finally {
    running = false;
  }
}

/** Olayı dinlemeye başlar; dönen fonksiyon aboneliği kaldırır. */
export function initItemIndexRefresh(): () => void {
  const handler = (e: Event): void => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (!id) return;
    queue.add(id);
    schedule();
  };
  window.addEventListener('vault-item-index-dirty', handler);
  return () => window.removeEventListener('vault-item-index-dirty', handler);
}
