import { useReducedMotion, type motion } from 'motion/react';
import type { ComponentProps } from 'react';

type MotionDivProps = ComponentProps<typeof motion.div>;

/*
 * Çekip-kapat (drag-to-dismiss) — yaprak/denetçiyi sürükleyip bırakınca kapatır.
 *
 * `x` ekseni sağ denetçi (sağa çek), `y` ekseni merkezî yaprak (aşağı çek).
 * Momentum eşiği geçilirse mesafeden bağımsız kapanır — bir "flick" yeter
 * (emil: hız > ~0.11; burada px/s cinsinden 600). Azaltılmış harekette
 * sürükleme tamamen kapanır; kapatma düğmesi ve Escape yolu kalır.
 */
export function useDragDismiss(axis: 'x' | 'y', onDismiss: () => void): Partial<MotionDivProps> {
  const reduce = useReducedMotion();
  if (reduce) return {};

  return {
    drag: axis,
    dragConstraints: axis === 'x' ? { left: 0, right: 0 } : { top: 0, bottom: 0 },
    dragElastic: axis === 'x' ? { left: 0, right: 0.55 } : { top: 0, bottom: 0.55 },
    dragMomentum: false,
    onDragEnd: (_event, info) => {
      const offset = axis === 'x' ? info.offset.x : info.offset.y;
      const velocity = axis === 'x' ? info.velocity.x : info.velocity.y;
      if (offset > 120 || velocity > 600) onDismiss();
    },
  };
}
