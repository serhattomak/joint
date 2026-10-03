import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Captions, FilePlus2, RotateCcw, Sparkles } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { PageSurface } from '@/components/ui/page-surface';
import { getItem, getTagsForItem, listItems, updateItem } from '@/lib/db/client';
import { applyCategorization, categorizeAndTagItem, getAiStatus, indexItemChunks, shouldApplySuggestion } from '@/lib/ai';
import type { Item } from '@/lib/db/types';
import {
  embedSubtitle,
  extractSubtitle,
  getWhisperModel,
  getWhisperStatus,
  startTranscribe,
  useWhisperProgress,
  type TranscriptData,
  type WhisperLang,
  type WhisperStatus,
} from '@/lib/whisper';
import { basenameOf, embedOutputPath, splitPath, stemOf, transcriptSrtPath } from '@/lib/convert-path';
import { toVaultSources } from '@/lib/vault-sources';
import { useComponentInstaller } from '@/components/ComponentInstaller';
import { missingComponentText, parseMissingComponent } from '@/lib/components';

interface SubtitleSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface SubtitleOutput {
  label: string;
  path: string;
  kind: 'gömülü' | 'çıkarılan';
}

interface SubtitleToolProps {
  refreshKey: number;
  onDone: () => void;
  /** Verilirse başlıkta "Araçlar'a dön" eylemi çizilir. */
  onClose?: () => void;
}

type BusyKind = '' | 'transcribe' | 'embed' | 'extract';

const LANGS: { id: WhisperLang; label: string }[] = [
  { id: 'auto', label: 'Otomatik' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'İngilizce' },
];

// Çıkarılan altyazı: <stem>-cikartilmis.srt (transkript yolundan ayrı, çakışmasın).
function extractSrtPath(videoPath: string): string {
  const { dir, sep, base } = splitPath(videoPath);
  const { stem } = stemOf(base);
  const name = `${stem}-cikartilmis.srt`;
  return dir ? `${dir}${sep}${name}` : name;
}

export function SubtitleTool({ refreshKey, onDone, onClose }: SubtitleToolProps) {
  const [sources, setSources] = useState<SubtitleSource[]>([]);
  const [selected, setSelected] = useState<SubtitleSource | null>(null);
  const [lang, setLang] = useState<WhisperLang>('auto');
  const [model, setModel] = useState(() => getWhisperModel());
  const [status, setStatus] = useState<WhisperStatus | null>(null);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState<BusyKind>('');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [customSrt, setCustomSrt] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<SubtitleOutput[]>([]);
  const [aiNotice, setAiNotice] = useState<{
    message: string;
    status: 'applied' | 'suggested';
    categories?: string[];
    tags?: string[];
    itemId?: string;
  } | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const installer = useComponentInstaller();

  useEffect(() => {
    void listItems()
      .then((items: Item[]) => {
        const next = toVaultSources(items);
        setSources(next);
        setSelected((prev) => (prev && next.some((s) => s.inputPath === prev.inputPath) ? prev : null));
      })
      .catch(() => setSources([]));
    setModel(getWhisperModel());
    void getWhisperStatus().then(setStatus);
  }, [refreshKey]);

  useWhisperProgress((e) => {
    if (e.jobId === jobIdRef.current) setPercent(Math.round(e.percent));
  });

  const pickExternal = async (): Promise<void> => {
    try {
      const picked = await openDialog({ multiple: false });
      const path = typeof picked === 'string' ? picked : null;
      if (path) setSelected({ label: basenameOf(path), inputPath: path });
    } catch {
      /* vazgeçme sessiz */
    }
  };

  const pickSrt = async (): Promise<void> => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: 'Altyazı', extensions: ['srt'] }],
      });
      if (typeof picked === 'string') setCustomSrt(picked);
    } catch {
      /* vazgeçme sessiz */
    }
  };

  /*
   * Backend'in `BILESEN_EKSIK:<id>` tel sinyalini TEK akışa bağlar. Dönüş `true`
   * ise hata tüketilmiştir; çağıran ham metni göstermez.
   *
   * ffmpeg VE whisper aynı ortak akıştan geçer: kurulum diyaloğu açılır, kurulum
   * başarısında başarısız eylem `retry` ile kendiliğinden yeniden denenir.
   * Diyalog açılamazsa (durum okunamadı / downloadable=false) dürüst cümleye
   * düşülür; ölü diyalog gösterilmez.
   *
   * 7c-3: whisper Bileşenler'den indirilebilir olduğu için (downloadable=true)
   * eski "whisper'a özel, yalnız dürüst metin" dalı KALDIRILDI. Ön kontrol de
   * aynı sebeple kaldırıldı: taze `whisper_status`'a dayanan eski hızlı yol,
   * motor kurulduktan sonra BAYAT kalıp sonsuz "kurulu değil" mesajı üretebilirdi
   * (retry anında state henüz tazelenmemişti). Kararı artık backend'in sinyali
   * verir — tek kaynak, bayat durum yok.
   *
   * Önek hiçbir dalda DOM'a ulaşmaz: metin daima missingComponentText'ten gelir
   * (id ve detail işaretçiden arındırılır).
   */
  const handleMissingComponent = (rawError: unknown, retry: () => void): boolean => {
    const parsed = parseMissingComponent(rawError);
    if (!parsed) return false;
    void installer.request(parsed.id, retry).then((result) => {
      if (result === 'unavailable') setError(missingComponentText(parsed));
    });
    return true;
  };

  const runTranscribe = async (): Promise<void> => {
    if (busy || !selected) return;
    /*
     * Model eksikse backend'e gitmeden dürüst yönlendirme. Model dosyası artık
     * Bileşenler ekranından iner; burada diyalog AÇILMAZ çünkü ön kontrolün
     * dayandığı `whisper_status` kurulumdan sonra bayat kalır ve aynı diyaloğu
     * sonsuz döngüde yeniden açardı. Motor eksikse zaten backend'in
     * `BILESEN_EKSIK:whisper` sinyali ortak kurulum akışını açar.
     */
    if (status && !status.models[model]) {
      setError(`Whisper ${model} modeli indirilmedi. Ayarlar → Bileşenler bölümünden indirebilirsin.`);
      return;
    }
    setBusy('transcribe');
    setError(null);
    setAiNotice(null);
    setPercent(0);
    const transcribeJob = crypto.randomUUID();
    jobIdRef.current = transcribeJob;
    const res = await startTranscribe(selected.inputPath, model, lang, transcribeJob);
    if (!res.ok || !res.data) {
      if (handleMissingComponent(res.error, () => void runTranscribe())) {
        setBusy('');
        return;
      }
      setError(res.error ?? 'Transkript üretilemedi.');
      setBusy('');
      return;
    }
    setPercent(100);
    // A7: transkript SADECE önizleme — arşive otomatik yazılmaz.
    setTranscript(res.data);
    setBusy('');

    // Whisper bittiğinde: Kayıtlı arşiv öğesi ise arka planda chunk indeksleme ve akıllı analiz tetikle
    if (selected.itemId) {
      const itemId = selected.itemId;
      const srtData = res.data;
      void (async () => {
        try {
          const item = await getItem(itemId);
          if (!item) return;
          const tags = await getTagsForItem(itemId);
          // 1. Chunk & Vektör indeksleme
          await indexItemChunks(item, tags.map((t) => t.name), srtData.preview);

          // 2. AI motoru hazırsa otomatik kategori/etiketleme analizi
          const aiStat = await getAiStatus().catch(() => null);
          if (aiStat?.engine_available && aiStat.llm_ready) {
            const catResult = await categorizeAndTagItem(item);
            const hasSuggestions = catResult.categories.length > 0 || catResult.tags.length > 0;
            if (hasSuggestions && shouldApplySuggestion(catResult, !!aiStat.auto_apply_tags)) {
              await applyCategorization(itemId, catResult.categories, catResult.tags);
              setAiNotice({
                message: `Otomatik uygulandı: ${catResult.categories.join(', ')} / ${catResult.tags.map((t) => '#' + t).join(' ')}`,
                status: 'applied',
              });
            } else if (hasSuggestions) {
              setAiNotice({
                message: `AI Önerisi: ${catResult.categories.join(', ')} / ${catResult.tags.map((t) => '#' + t).join(' ')}`,
                status: 'suggested',
                categories: catResult.categories,
                tags: catResult.tags,
                itemId,
              });
            }
          }
        } catch (err) {
          console.error('[SubtitleTool] Post-whisper AI analizi hatası:', err);
        }
      })();
    }
  };

  const runEmbed = async (srtPath: string | null): Promise<void> => {
    if (busy || !selected || !srtPath) return;
    // Gömme yalnızca ffmpeg ister: whisper ön kontrolü YOK. Eksik ffmpeg,
    // backend'in `BILESEN_EKSIK:ffmpeg` sinyaliyle ortak kurulum akışını açar.
    const output = embedOutputPath(selected.inputPath);
    setBusy('embed');
    setError(null);
    setPercent(0);
    const embedJob = crypto.randomUUID();
    jobIdRef.current = embedJob;
    const res = await embedSubtitle(selected.inputPath, srtPath, output, embedJob);
    if (!res.ok) {
      if (handleMissingComponent(res.error, () => void runEmbed(srtPath))) {
        setBusy('');
        return;
      }
      setError(res.error ?? 'Altyazı gömülemedi.');
      setBusy('');
      return;
    }
    setPercent(100);
    // A14: gömülü çıktı vault'a bağlanır.
    if (selected.itemId) {
      try {
        await updateItem(selected.itemId, { converted_path: output });
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Vault kaydı güncellenemedi.');
        setBusy('');
        return;
      }
    }
    setOutputs((prev) => [{ label: basenameOf(output), path: output, kind: 'gömülü' }, ...prev]);
    setBusy('');
    onDone();
  };

  const runExtract = async (): Promise<void> => {
    if (busy || !selected) return;
    // Çıkarma yalnızca ffmpeg ister: whisper ön kontrolü burada gereksizdi.
    const output = extractSrtPath(selected.inputPath);
    setBusy('extract');
    setError(null);
    setPercent(0);
    const extractJob = crypto.randomUUID();
    jobIdRef.current = extractJob;
    const res = await extractSubtitle(selected.inputPath, output, extractJob, 0);
    if (!res.ok) {
      if (handleMissingComponent(res.error, () => void runExtract())) {
        setBusy('');
        return;
      }
      setError(res.error ?? 'Altyazı çıkarılamadı.');
      setBusy('');
      return;
    }
    setPercent(100);
    setOutputs((prev) => [{ label: basenameOf(output), path: output, kind: 'çıkarılan' }, ...prev]);
    setBusy('');
    onDone();
  };

  const srtForEmbed = transcript?.srt_path ?? customSrt;
  const expectedSrt = selected ? transcriptSrtPath(selected.inputPath) : '';

  return (
    <PageSurface
      icon={<Captions />}
      title="Altyazı"
      description="Altyazı göm, çıkar veya otomatik üret."
      width="5xl"
      actions={
        onClose ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            <ArrowLeft /> Araçlar&apos;a dön
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="settings-card flex min-h-0 flex-col gap-2 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-micro font-medium text-muted-foreground">Kaynak</h3>
            <Button variant="ghost" size="sm" onClick={() => void pickExternal()}>
              <FilePlus2 /> Dosya seç
            </Button>
          </div>
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {sources.length === 0 && (
              <li className="px-1 py-6 text-center text-xs text-muted-foreground">
                Henüz kaynak yok. İndirilenler otomatik listelenir, harici dosya seçebilirsin.
              </li>
            )}
            {sources.map((s) => {
              const active = selected?.inputPath === s.inputPath;
              return (
                <li key={`${s.itemId ?? 'ext'}:${s.inputPath}`}>
                  <button
                    type="button"
                    onClick={() => !busy && setSelected(s)}
                    disabled={!!busy}
                    aria-pressed={active}
                    className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-sm transition disabled:opacity-60 ${
                      active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex min-h-0 flex-col gap-4">
          <section className="settings-card flex min-h-0 flex-col gap-3 p-4">
            <h3 className="text-micro font-medium text-muted-foreground">
              Otomatik transkript
            </h3>
            {!selected ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Transkript için soldan bir kaynak seç.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    Model: <span className="font-medium text-foreground">{model}</span>
                    <span className="text-xs"> (Ayarlar → Konuşma&apos;dan değiştir)</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    Dil
                    <Select
                      label="Transkript dili"
                      className="w-36"
                      size="sm"
                      disabled={!!busy}
                      value={lang}
                      onValueChange={(v) => setLang(v as WhisperLang)}
                      options={LANGS.map((l) => ({ value: l.id, label: l.label }))}
                    />
                  </span>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground" title={expectedSrt}>
                  → {expectedSrt}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void runTranscribe()} disabled={!!busy}>
                    <Sparkles /> {busy === 'transcribe' ? `%${percent} yazıya dökülüyor…` : 'Transkript üret'}
                  </Button>
                  {transcript && (
                    <Button
                      variant="outline"
                      onClick={() => void runEmbed(transcript.srt_path)}
                      disabled={!!busy}
                    >
                      <Captions /> {busy === 'embed' ? `%${percent} gömülüyor…` : 'Altyazıyı videoya göm'}
                    </Button>
                  )}
                  {error && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runTranscribe()}
                      disabled={!!busy}
                    >
                      <RotateCcw /> Tekrar dene
                    </Button>
                  )}
                </div>
                {busy === 'transcribe' && (
                  <div className="h-1.5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                )}
                {transcript && (
                  <div className="flex flex-col gap-1.5">
                    <p className="truncate font-mono text-xs text-muted-foreground" title={transcript.srt_path}>
                      .srt kaydedildi: {transcript.srt_path}
                    </p>
                    <pre className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                      {transcript.preview}
                    </pre>
                    <p className="text-xs text-muted-foreground">
                      Önizleme yalnızca ilk 40 satır — arşive otomatik yazılmaz.
                    </p>

                    {aiNotice && (
                      <div className="mt-2 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-xs text-foreground">
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-4 shrink-0 text-primary" />
                          <span>{aiNotice.message}</span>
                        </div>
                        {aiNotice.status === 'suggested' && aiNotice.itemId && aiNotice.categories && (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-6 px-2 text-3xs font-medium"
                            onClick={async () => {
                              const { itemId, categories, tags } = aiNotice;
                              if (!itemId || !categories) return;
                              await applyCategorization(itemId, categories, tags || []);
                              setAiNotice({
                                message: 'Kategoriler ve etiketler arşive başarıyla uygulandı.',
                                status: 'applied',
                              });
                            }}
                          >
                            Uygula
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="settings-card flex min-h-0 flex-col gap-3 p-4">
            <h3 className="text-micro font-medium text-muted-foreground">Göm / Çıkar</h3>
            {!selected ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Gömme/çıkarma için soldan bir video seç.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={customSrt ?? ''}>
                    Altyazı: {customSrt ?? transcript?.srt_path ?? 'seçilmedi'}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => void pickSrt()} disabled={!!busy}>
                    <FilePlus2 /> .srt seç
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void runEmbed(srtForEmbed ?? null)}
                    disabled={!!busy || !srtForEmbed}
                  >
                    <Captions /> {busy === 'embed' ? `%${percent} gömülüyor…` : 'Videoya göm'}
                  </Button>
                  <Button variant="outline" onClick={() => void runExtract()} disabled={!!busy}>
                    <Sparkles /> {busy === 'extract' ? `%${percent} çıkarılıyor…` : 'Altyazıyı çıkar (ilk akış)'}
                  </Button>
                  {error && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runExtract()}
                      disabled={!!busy}
                    >
                      <RotateCcw /> Tekrar dene
                    </Button>
                  )}
                </div>
                {(busy === 'embed' || busy === 'extract') && (
                  <div className="h-1.5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                {outputs.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-border pt-3">
                    <h4 className="text-micro font-medium text-muted-foreground">
                      Bu oturumda üretilenler
                    </h4>
                    <ul className="flex flex-col gap-1">
                      {outputs.map((o) => (
                        <li key={o.path} className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{o.label}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{o.path}</p>
                          </div>
                          <Badge variant="outline">{o.kind}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </PageSurface>
  );
}
