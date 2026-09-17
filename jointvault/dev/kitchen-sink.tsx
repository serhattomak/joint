/*
 * Doğrulama tezgâhı — üretim kodu DEĞİL.
 * Kartoteks dünyasının atomlarını gerçek bileşenlerle, sentetik veriyle basar ki
 * token'lar, odak, durum sözlüğü ve fiş yüzeyi tek renderda görülebilsin.
 * Buradaki her örnek içerik SENTETİK'tir; ürün iddiası taşımaz.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGroup, SettingRow } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { NoticeProvider, useNotice } from '@/components/ui/notice';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Stamp, PlatformRule, type StampState } from '@/components/ui/stamp';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { ItemCardView, ItemRowView, type ItemViewProps } from '@/components/ItemViews';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AddItemDialog } from '@/components/AddItemDialog';
import type { Item } from '@/lib/db/types';

const SYNTH = 'sentetik';
const noop = (): void => undefined;

const syntheticItem = (over: Partial<Item>, n: number): Item => ({
  id: `synthetic-${n}`,
  url: `https://example.invalid/kayit/${n}`,
  title: `Sentetik kayıt ${n} — arşiv fişi başlığı iki satıra taşacak kadar uzun`,
  note: null,
  platform: 'youtube',
  thumbnail: null,
  favorite: false,
  collection_id: null,
  user_id: null,
  local_path: null,
  download_status: 'none',
  download_error: null,
  converted_path: null,
  created_at: new Date(2026, 8, 12 + n).toISOString(),
  updated_at: new Date(2026, 8, 12 + n).toISOString(),
  ...over,
});

const SHOTS: { item: Item; progress?: number; meta?: ItemViewProps['meta'] }[] = [
  { item: syntheticItem({ platform: 'instagram', favorite: true }, 1) },
  {
    item: syntheticItem({ platform: 'x', download_status: 'active' }, 2),
    progress: 42,
    meta: { speed: '1,2 MB/s', eta: '0:40' },
  },
  {
    item: syntheticItem({ platform: 'tiktok', download_status: 'error', download_error: 'HTTP 403 — erişim reddedildi' }, 3),
  },
  { item: syntheticItem({ platform: 'pinterest', download_status: 'done', local_path: 'C:\\yol\\dosya.mp4' }, 4) },
  { item: syntheticItem({ platform: 'other', download_status: 'queued' }, 5) },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b border-border pb-1 font-mono text-2xs tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Harness() {
  const [tab, setTab] = useState('bir');
  const [on, setOn] = useState(true);
  const [quality, setQuality] = useState('1080');
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const notice = useNotice();
  const sink: ItemViewProps = {
    item: SHOTS[0].item,
    tags: [],
    categories: [],
    collectionLabel: null,
    selected: false,
    index: 0,
    onToggle: noop,
    onFavorite: noop,
    onDelete: noop,
    onOpen: noop,
    progress: undefined,
    onAudio: noop,
    onPickVideo: noop,
    onConvert: noop,
  };

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-display">JointVault · Kartoteks</h1>
          <Badge variant="secondary">doğrulama tezgâhı · {SYNTH} veri</Badge>
        </header>

        <Section title="Damga — durum sözlüğü">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                'none',
                'queued',
                'active',
                'local',
                'error',
                'duplicate',
                'favorite',
                'converted',
              ] as StampState[]
            ).map((s) => (
              <Stamp key={s} state={s} />
            ))}
          </div>
        </Section>

        <Section title="Platform kuralı">
          <div className="grid grid-cols-6 gap-3">
            {['instagram', 'tiktok', 'x', 'pinterest', 'youtube', 'other'].map((p) => (
              <div key={p} className="border border-border bg-card">
                <PlatformRule platform={p} />
                <p data-num className="px-2 py-1.5 text-2xs text-muted-foreground">
                  {p}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buton — varyant ve boyut">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Kaydet</Button>
            <Button variant="stamp">Damgala</Button>
            <Button variant="outline">Dışa çizgi</Button>
            <Button variant="secondary">İkincil</Button>
            <Button variant="ghost">Sessiz</Button>
            <Button variant="destructive">Sil</Button>
            <Button variant="link">Bağlantı</Button>
            <Button disabled>Kapalı</Button>
            <Button size="xs">Çok küçük</Button>
            <Button size="sm">Küçük</Button>
            <Button size="lg">Büyük</Button>
          </div>
        </Section>

        <Section title="Giriş ve alan">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Başlık" hint="Künyeye yazılır.">
              <Input placeholder="Başlık" />
            </Field>
            <Field label="Hatalı alan" error="Bu alan boş bırakılamaz.">
              <Input aria-invalid placeholder="https://…" />
            </Field>
            <Field label="Kapalı">
              <Input disabled defaultValue="değiştirilemez" />
            </Field>
            <Field label="Sayı alanı">
              <Input data-num defaultValue="1.284" inputMode="numeric" />
            </Field>
            <Field label="Not" className="sm:col-span-2">
              <Textarea rows={2} placeholder="Not" />
            </Field>
          </div>
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <SettingRow label="Favori">
              <Switch checked={on} onCheckedChange={setOn} />
            </SettingRow>
            <SettingRow label="Kalite" hint="Video ve ses indirmesinde.">
              <Select
                label="Kalite"
                className="w-40"
                value={quality}
                onValueChange={setQuality}
                options={[
                  { value: '2160', label: '2160p', hint: 'en yüksek' },
                  { value: '1080', label: '1080p', hint: 'önerilen' },
                  { value: '720', label: '720p' },
                  { value: '480', label: '480p' },
                ]}
              />
            </SettingRow>
          </div>
        </Section>

        <Section title="İlerleme">
          <div className="flex max-w-md flex-col gap-3">
            <Progress value={42} />
            <Progress value={100} />
            <Progress value={7} />
          </div>
        </Section>

        <Section title="Sekmeler">
          <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
            <TabsList>
              {['bir', 'iki', 'üç'].map((t) => (
                <TabsTab key={t} value={t}>
                  Sekme {t}
                </TabsTab>
              ))}
            </TabsList>
            <TabsPanel>
              <p className="text-sm text-muted-foreground">Seçili sekme: {tab}</p>
            </TabsPanel>
          </Tabs>
        </Section>

        <Section title="Fiş kartı">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SHOTS.map((s, i) => (
              <ItemCardView key={s.item.id} {...sink} item={s.item} index={i} progress={s.progress} meta={s.meta} />
            ))}
          </div>
        </Section>

        <Section title="Defter satırı">
          <div className="divide-y divide-border border border-border bg-card">
            {SHOTS.map((s) => (
              <ItemRowView key={s.item.id} {...sink} item={s.item} progress={s.progress} meta={s.meta} />
            ))}
          </div>
        </Section>

        <Section title="Künye alanı ve açılır katmanlar">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog(true)}>
              Diyalog
            </Button>
            <Button variant="destructive" onClick={() => setConfirm(true)}>
              Onay
            </Button>
            <Button
              variant="stamp"
              onClick={() => notice.push({ text: 'Fişe geçti.', tone: 'ok', action: { label: 'Geri al', run: noop } })}
            >
              Bildirim bas
            </Button>
            <Button
              variant="outline"
              onClick={() => notice.push({ text: 'Kaydedilemedi — bağlantı zaman aşımına uğradı.', tone: 'error' })}
            >
              Hata bildirimi
            </Button>
          </div>
          <FieldGroup title="Künye">
            <SettingRow label="Kaynak" hint="Diskteki yol">
              <span data-num className="text-micro text-muted-foreground">
                anahtar · değer
              </span>
            </SettingRow>
          </FieldGroup>
        </Section>
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Örnek yaprak</DialogTitle>
            <DialogDescription>
              Modal yalnızca kesinti veya korunmuş odak gerektiren işler için burada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Kapat
            </Button>
            <Button variant="stamp" onClick={() => setDialog(false)}>
              Onayla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Bu fiş silinsin mi?"
        description="Kayıt arşivden çıkar. İndirilen dosya diskte kalır."
        confirmLabel="Sil"
        onConfirm={noop}
      />

      <AddItemDialog open={false} onOpenChange={noop} onSaved={noop} />
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <NoticeProvider>
    <TooltipProvider delay={100}>
      <Harness />
    </TooltipProvider>
  </NoticeProvider>,
);
