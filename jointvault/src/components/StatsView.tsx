import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageSurface } from '@/components/ui/page-surface';
import { Button } from '@/components/ui/button';
import { getVaultStats, type VaultStats } from '@/lib/db/client';
import { describeError } from '@/lib/errors';
import { PLATFORM_META, PLATFORM_ORDER, type Platform } from '@/lib/platform';

interface StatsViewProps {
  refreshKey: number;
}

/*
 * Grafik mürekkebi de dünyanın sözlüğünden gelir: platformlar sınıflandırma
 * mürekkebini, indirme durumları damga sözlüğünü kullanır. Eski kiremit/amber
 * paleti bilerek kaldırıldı — terk edilen dünyanın rengi buraya sızamaz.
 */
const SRC_INK: Record<string, string> = {
  instagram: 'var(--color-src-instagram)',
  tiktok: 'var(--color-src-tiktok)',
  x: 'var(--color-src-x)',
  pinterest: 'var(--color-src-pinterest)',
  youtube: 'var(--color-src-youtube)',
  other: 'var(--color-src-other)',
};
const PLATFORM_INK: Record<string, string> = Object.fromEntries(
  PLATFORM_ORDER.map((p) => [PLATFORM_META[p].label, SRC_INK[p]]),
);
const platformInk = (name: string): string => PLATFORM_INK[name] ?? 'var(--color-muted-foreground)';

const STATUS_INK: Record<string, string> = {
  İndi: 'var(--color-state-acquired)',
  Arşiv: 'var(--color-state-queued)',
  Sırada: 'var(--color-state-active)',
  Hatalı: 'var(--color-state-error)',
};
const statusInk = (name: string): string => STATUS_INK[name] ?? 'var(--color-muted-foreground)';

export function StatsView({ refreshKey }: StatsViewProps) {
  const [data, setData] = useState<VaultStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void getVaultStats()
      .then((next) => {
        if (live) setData(next);
      })
      .catch((e: unknown) => {
        if (live) setError(describeError(e, 'İstatistikler yüklenemedi.'));
      });
    return () => {
      live = false;
    };
  }, [refreshKey, attempt]);

  if (!data) {
    return (
      <PageSurface icon={<BarChart3 strokeWidth={2} />} title="İstatistikler" width="4xl">
        {error ? (
          <div className="settings-card flex max-w-2xl flex-col items-start gap-3 p-4">
            <p className="text-sm text-state-error">{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                setAttempt((a) => a + 1);
              }}
            >
              Yeniden dene
            </Button>
          </div>
        ) : (
          <div
            className="skeleton-paper h-40 max-w-2xl rounded-xl border border-border"
            aria-label="İstatistikler yükleniyor"
          />
        )}
      </PageSurface>
    );
  }

  const platformData = [...data.platforms]
    .sort(
      (a, b) =>
        PLATFORM_ORDER.indexOf(a.name as Platform) - PLATFORM_ORDER.indexOf(b.name as Platform),
    )
    .map((p) => ({
      name: PLATFORM_META[p.name as Platform]?.label ?? p.name,
      value: p.value,
    }))
    .filter((d) => d.value > 0);

  const collectionData = data.collections;
  const categoryData = data.categories;
  const tagData = data.tags;

  const plain = data.total - data.downloaded - data.inFlight - data.failed;

  const dlData = [
    { name: 'İndi', value: data.downloaded },
    { name: 'Arşiv', value: plain },
    { name: 'Sırada', value: data.inFlight },
    { name: 'Hatalı', value: data.failed },
  ].filter((d) => d.value > 0);

  const stats: [string, number][] = [
    ['Toplam kayıt', data.total],
    ['Favori', data.favorites],
    ['İndirilen', data.downloaded],
    ['Etiket', data.tagCount],
  ];

  const bar = (data: { name: string; value: number }[], title: string): React.ReactNode => (
    <section className="settings-card p-3">
      <h3 className="mb-2 flex h-6 items-center border-b border-border pb-1 text-micro font-medium text-muted-foreground">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Veri yok.</p>
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={platformInk(data[i]?.name ?? '')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );

  return (
    <PageSurface icon={<BarChart3 strokeWidth={2} />} title="İstatistikler" width="4xl">
      <div className="flex flex-col gap-4">
      <section className="settings-card max-w-2xl divide-y divide-border/70">
        <h3 className="px-3 py-1.5 text-micro font-medium text-muted-foreground">Arşiv özeti</h3>
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2">
            <span className="text-sm">{label}</span>
            <span data-num className="text-sm tabular-nums">
              {value}
            </span>
          </div>
        ))}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {bar(platformData, 'Platform dağılımı')}
        <section className="settings-card p-3">
          <h3 className="mb-2 flex h-6 items-center border-b border-border pb-1 text-micro font-medium text-muted-foreground">İndirme durumu</h3>
          {dlData.length === 0 ? (
            <p className="text-xs text-muted-foreground">Veri yok.</p>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dlData} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 11 }}>
                    {dlData.map((_, i) => (
                      <Cell key={i} fill={statusInk(dlData[i]?.name ?? '')} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
        {bar(collectionData, 'Koleksiyonlar (ilk 8)')}
        {bar(categoryData, 'Kategoriler (ilk 8)')}
        {bar(tagData, 'Etiketler (ilk 8)')}
      </div>
      </div>
    </PageSurface>
  );
}
