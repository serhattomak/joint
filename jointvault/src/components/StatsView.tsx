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
import {
  getAllCategoriesByItem,
  getAllTagsByItem,
  listCollections,
  listItems,
} from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { PLATFORM_META, PLATFORM_ORDER } from '@/lib/platform';

interface StatsViewProps {
  refreshKey: number;
}

const BAR_COLORS = ['#9a3412', '#b45309', '#a16207', '#4d7c0f', '#0f766e', '#57534e'];
const PIE_COLORS = ['#9a3412', '#d6d3d1', '#b91c1c', '#a8a29e'];

function countBy(rows: Item[], pick: (it: Item) => string[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const it of rows) for (const k of pick(it)) map.set(k, (map.get(k) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function StatsView({ refreshKey }: StatsViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [tagNames, setTagNames] = useState<Record<string, string[]>>({});
  const [catNames, setCatNames] = useState<Record<string, string[]>>({});
  const [colNames, setColNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const [rows, cols, tagMap, catMap] = await Promise.all([
        listItems(),
        listCollections(),
        getAllTagsByItem(),
        getAllCategoriesByItem(),
      ]);
      if (!live) return;
      setItems(rows);
      setColNames(Object.fromEntries(cols.map((c) => [c.id, c.name])));
      const tn: Record<string, string[]> = {};
      for (const [id, ts] of Object.entries(tagMap)) tn[id] = ts.map((t) => `#${t.name}`);
      setTagNames(tn);
      const cn: Record<string, string[]> = {};
      for (const [id, cs] of Object.entries(catMap)) cn[id] = cs.map((c) => c.name);
      setCatNames(cn);
    })();
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const platformData = PLATFORM_ORDER.map((p) => ({
    name: PLATFORM_META[p].label,
    value: items.filter((it) => it.platform === p).length,
  })).filter((d) => d.value > 0);

  const collectionData = countBy(items, (it) => (it.collection_id ? [colNames[it.collection_id] ?? '?'] : [])).slice(0, 8);
  const categoryData = countBy(items, (it) => catNames[it.id] ?? []).slice(0, 8);
  const tagData = countBy(items, (it) => tagNames[it.id] ?? []).slice(0, 8);

  const done = items.filter((it) => it.download_status === 'done').length;
  const active = items.filter((it) => it.download_status === 'active' || it.download_status === 'queued').length;
  const failed = items.filter((it) => it.download_status === 'error').length;
  const plain = items.length - done - active - failed;
  const fav = items.filter((it) => it.favorite).length;

  const dlData = [
    { name: 'İndi', value: done },
    { name: 'Arşiv', value: plain },
    { name: 'Sırada', value: active },
    { name: 'Hatalı', value: failed },
  ].filter((d) => d.value > 0);

  const stats: [string, number][] = [
    ['Toplam öğe', items.length],
    ['Favori', fav],
    ['İndirilen', done],
    ['Etiket', Object.values(tagNames).flat().filter((v, i, a) => a.indexOf(v) === i).length],
  ];

  const bar = (data: { name: string; value: number }[], title: string): React.ReactNode => (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <h3 className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{title}</h3>
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
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-5 text-primary" strokeWidth={2} />
        <h2 className="font-display text-xl tracking-tight">İstatistikler</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="font-display text-2xl tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {bar(platformData, 'Platform dağılımı')}
        <section className="rounded-xl border border-border bg-card p-4 shadow-card">
          <h3 className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">İndirme durumu</h3>
          {dlData.length === 0 ? (
            <p className="text-xs text-muted-foreground">Veri yok.</p>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dlData} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 11 }}>
                    {dlData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
  );
}
