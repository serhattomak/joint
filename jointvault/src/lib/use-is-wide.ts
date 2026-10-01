import { useEffect, useState } from 'react';

/*
 * Kaba kırılım sorgusu — yalnızca düzeni JS ile dallandırmak gerektiğinde.
 * Örnek: kayıt paneli geniş pencerede sağ denetçi (modal değil), dar pencerede
 * modal yaprak olur; bu ayrım CSS ile değil modal semantiğiyle verilir.
 */
export function useIsWide(query = '(min-width: 1024px)'): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return wide;
}
