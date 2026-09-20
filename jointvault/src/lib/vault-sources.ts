/*
 * Arşiv öğelerini medya araçlarının kaynak listesine çevirir.
 *
 * Beş araç bu dönüşümü kopyalıyordu ve dosyası olmayan öğeyi elemek için
 * `it.local_path as string` yazmak zorundaydı — cast, `null` bir yolun araca
 * sızmasını gizliyordu. `flatMap` daraltma yaptığı için cast gerekmez.
 */
import { basenameOf } from './convert-path';
import type { Item } from './db/types';

/** Araç kaynak seçicisinin tek satırı (beş aracın ortak şekli). */
export interface VaultSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

/** Yerel dosyası olan öğeleri kaynağa çevirir; dosyası olmayanları atlar. */
export const toVaultSources = (items: Item[]): VaultSource[] =>
  items.flatMap((item) =>
    item.local_path
      ? [
          {
            label: item.title || basenameOf(item.local_path),
            inputPath: item.local_path,
            itemId: item.id,
          },
        ]
      : [],
  );
