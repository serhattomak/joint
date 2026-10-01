import type { ReactNode } from 'react';

/*
 * Sayfa yüzeyi — tam-sayfa görünümlerin tek kabuğu.
 *
 * Koleksiyonlar, indirmeler, eşitleme, istatistikler ve araç kutusu aynı sayfa
 * ritmine oturur: solda ikon çipi, tek başlık ölçeği (`text-title`), isteğe bağlı
 * açıklama ve sağda eylemler. Padding tektir; genişlik içeriğe göre seçilir —
 * böylece her görünümün kendi `min-h-screen` / `max-w-*` / `px-*` kabuğunu
 * yazması sürüklenmeye dönüşmez.
 *
 * Kaydırma buraya ait DEĞİL: kök `min-h-screen`, yakala çubuğu `sticky` ve içerik
 * sayfa olarak akar. Yüzey yalnızca kolonu kurar; kendi kaydırma kabını açsaydı
 * kabuk ile çakışırdı (eski görünümlerin `min-h-screen` sayfa kabukları gibi).
 */

type PageWidth = '3xl' | '4xl' | '5xl' | '6xl' | 'full';

const WIDTH: Record<PageWidth, string> = {
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  full: 'max-w-none',
};

interface PageSurfaceProps {
  /** Başlığın solundaki ikon; boyutu çip tarafından verilir (18px). */
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Başlığın sağındaki eylemler. */
  actions?: ReactNode;
  width?: PageWidth;
  children: ReactNode;
}

export function PageSurface({
  icon,
  title,
  description,
  actions,
  width = '4xl',
  children,
}: PageSurfaceProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className={`mx-auto w-full ${WIDTH[width]} px-6 pt-6 pb-12 md:px-8`}>
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-[18px]"
                aria-hidden
              >
                {icon}
              </span>
              <h1 className="text-title">{title}</h1>
            </div>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
