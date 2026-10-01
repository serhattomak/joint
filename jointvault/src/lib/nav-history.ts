/*
 * Görünüm geçmişi — geri/ileri. Yığın, ziyaret edilen görünüm kimliklerini tutar;
 * yeni bir gezinme, geri gidilmişse ileri yığınını kırpar (tarayıcı geçmişi gibi).
 */

export interface NavHistory<T extends string> {
  stack: T[];
  index: number;
}

/** Yeni hedefi ekler. Aynı hedefse nesneyi değiştirmez; değilse ileri yığınını kırpar. */
export function pushDest<T extends string>(h: NavHistory<T>, dest: T): NavHistory<T> {
  if (h.stack[h.index] === dest) return h;
  const stack = [...h.stack.slice(0, h.index + 1), dest];
  return { stack, index: stack.length - 1 };
}

/** Yığın içinde adım atar; sınır dışına çıkmaz (sınırda aynı nesneyi döndürür). */
export function stepDest<T extends string>(h: NavHistory<T>, delta: 1 | -1): NavHistory<T> {
  const index = h.index + delta;
  if (index < 0 || index >= h.stack.length) return h;
  return { stack: h.stack, index };
}
