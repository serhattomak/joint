import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { analyzeMissing } from '@/lib/analysis';
import {
  batchCategorizeItems,
  readTagThreshold,
  reindexVault,
  TAG_THRESHOLD_KEY,
} from '@/lib/ai';
import { createBackup } from '@/lib/db/backup';
import {
  getAllCategoriesByItem,
  getAllTagsByItem,
  getDb,
  listItems,
} from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { planItemMerge } from '@/lib/notebook';
import {
  applyMerges,
  makeNotebookDeps,
  readNotebookThreshold,
  runNotebookPipeline,
  writeNotebookThreshold,
  type DupeGroup,
  type NotebookReport,
} from '@/lib/notebook-pipeline';
import { DEDUPE_THRESHOLD_OPTIONS, THRESHOLD_OPTIONS } from './options';

interface AiMaintenanceSectionProps {
  aiEnabled: boolean;
  llmReady: boolean;
  embedReady: boolean;
}

export function AiMaintenanceSection({
  aiEnabled,
  llmReady,
  embedReady,
}: AiMaintenanceSectionProps) {
  const [reindexProgress, setReindexProgress] = useState<{
    current: number;
    total: number;
    phase: 'content' | 'vectors';
  } | null>(null);
  const [reindexBusy, setReindexBusy] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [recatBusy, setRecatBusy] = useState(false);
  const [recatProgress, setRecatProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);
  const [recatResult, setRecatResult] = useState<string | null>(null);
  const [confirmRecatOpen, setConfirmRecatOpen] = useState(false);

  const [organizeBusy, setOrganizeBusy] = useState(false);
  const [organizeProgress, setOrganizeProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [organizeResult, setOrganizeResult] = useState<string | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [tagThreshold, setTagThreshold] = useState(() => readTagThreshold());
  // Defteri Hazırla: adım göstergesi + rapor + tekrar grupları
  const [defterBusy, setDefterBusy] = useState(false);
  const [defterStep, setDefterStep] = useState<string | null>(null);
  const [defterReport, setDefterReport] = useState<NotebookReport | null>(null);
  const [defterGroups, setDefterGroups] = useState<DupeGroup[]>([]);
  const [defterDone, setDefterDone] = useState<Record<number, 'merged' | 'skipped'>>({});
  const [defterMsg, setDefterMsg] = useState<string | null>(null);
  const [defterError, setDefterError] = useState<string | null>(null);
  const [dedupeThreshold, setDedupeThreshold] = useState(() => readNotebookThreshold());
  // Grup bazında hedef değişimi (varsayılan: en eski kayıt)
  const [defterTargets, setDefterTargets] = useState<Record<number, string>>({});

  // Sıradaki öğe sınırında durur; görünüm kapanırsa iş kalmasın.
  useEffect(() => () => analysisAbortRef.current?.abort(), []);
  const handleThresholdChange = (v: string): void => {
    setTagThreshold(Number(v));
    try {
      localStorage.setItem(TAG_THRESHOLD_KEY, v);
    } catch {
      // localStorage erişilemezse sessizce geç
    }
  };

  /* Defteri Hazırla */
  const notebookCancelRef = useRef(false);
  const describeNotebookReport = (r: NotebookReport): string[] => {
    const out: string[] = [];
    out.push(
      r.scrapeFailed > 0
        ? `Adım 1: ${r.scraped} tamamlandı, ${r.scrapeFailed} başarısız`
        : `Adım 1: ${r.scraped} tamamlandı`,
    );
    const cat = r.categorize;
    out.push(!cat ? 'Adım 2: öğe yok' : 'aiOff' in cat ? 'Adım 2: AI kapalı, atlandı' : `Adım 2: ${cat.applied} uygulandı, ${cat.lowConfidence} düşük güven`);
    const dd = r.dedupe;
    if (!dd) out.push('Adım 3: taranacak öğe yok');
    else if (dd.aiOff) out.push('Adım 3: AI kapalı, atlandı');
    else out.push(`Adım 3: ${dd.groups.length} tekrar grubu`);
    return out;
  };
  const runNotebook = async (): Promise<void> => {
    setDefterBusy(true);
    setDefterError(null);
    setDefterMsg(null);
    setDefterGroups([]);
    setDefterDone({});
    setDefterTargets({});
    try {
      const report = await runNotebookPipeline(
        { ...makeNotebookDeps(), isCancelled: () => notebookCancelRef.current },
        (stage, done, total, label) => setDefterStep(`Adım ${stage}/3 · ${label}: ${done}/${total}`),
      );
      notebookCancelRef.current = false;
      setDefterReport(report);
      setDefterGroups(report.dedupe?.groups ?? []);
      setDefterMsg(describeNotebookReport(report).join(' · '));
    } catch (e) {
      setDefterError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Boru hattı başarısız.');
    } finally {
      setDefterBusy(false);
      setDefterStep(null);
    }
  };
  const mergeNotebookGroup = async (index: number): Promise<void> => {
    const resolved = resolveGroup(defterGroups[index], index);
    if (!resolved) return;
    setDefterBusy(true);
    try {
      const res = await applyMerges([resolved], makeNotebookDeps());
      setDefterDone((p) => ({ ...p, [index]: res.failedGroups.length === 0 ? 'merged' : 'skipped' }));
      if (res.failedGroups.length > 0) setDefterError(res.failedGroups[0].error);
    } finally {
      setDefterBusy(false);
    }
  };
  const mergeRemainingNotebook = async (): Promise<void> => {
    const pending = defterGroups
      .map((g, i) => resolveGroup(g, i))
      .filter((_, i) => !defterDone[i]);
    if (pending.length === 0) return;
    setDefterBusy(true);
    try {
      const res = await applyMerges(pending, makeNotebookDeps());
      setDefterError(res.failedGroups.length > 0 ? `${res.failedGroups.length} grup başarısız` : null);
      setDefterDone((p) => {
        const next = { ...p };
        for (let i = 0; i < defterGroups.length; i++) if (!next[i]) next[i] = 'merged';
        for (const fg of res.failedGroups) {
          const idx = defterGroups.findIndex((g) => g.targetId === fg.targetId);
          if (idx >= 0) next[idx] = 'skipped';
        }
        return next;
      });
      setDefterMsg(`Birleştirme: ${res.merged} kayıt birleşti, artıklar silindi.`);
    } finally {
      setDefterBusy(false);
    }
  };
  const retryFailedNotebook = async (): Promise<void> => {
    if (!defterReport || defterReport.scrapeFailures.length === 0) return;
    setDefterBusy(true);
    try {
      const res = await makeNotebookDeps().scrape(defterReport.scrapeFailures, (done, total) =>
        setDefterStep(`Yeniden kazıma: ${done}/${total}`),
      );
      setDefterReport({
        ...defterReport,
        scraped: defterReport.scraped + res.successCount,
        scrapeFailed: res.errorCount,
        scrapeFailures: res.failed,
      });
      setDefterMsg(res.failed.length === 0 ? 'Başarısızlar tamamlandı.' : `Hâlâ başarısız: ${res.failed.length}`);
    } catch (e) {
      setDefterError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Yeniden deneme başarısız.');
    } finally {
      setDefterBusy(false);
      setDefterStep(null);
    }
  };
  const handleDedupeThresholdChange = (v: string): void => {
    const value = Number(v);
    setDedupeThreshold(value);
    writeNotebookThreshold(value);
  };
  const trDateLabel = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString('tr-TR');
    } catch {
      return iso;
    }
  };
  const memberAsItem = (m: DupeGroup['members'][number]): Item =>
    ({
      id: m.id,
      url: m.url,
      title: m.title,
      note: m.note,
      platform: 'x',
      thumbnail: m.thumbnail,
      favorite: m.favorite,
      collection_id: null,
      user_id: null,
      created_at: m.created_at,
      updated_at: m.created_at,
      local_path: null,
      download_status: 'none',
      download_error: null,
      converted_path: null,
    }) as Item;
  const resolveGroup = (g: DupeGroup, index: number): DupeGroup => {
    const override = defterTargets[index];
    if (!override || override === g.targetId) return g;
    const target = g.members.find((m) => m.id === override);
    if (!target) return g;
    const rest = g.members.filter((m) => m.id !== override).map(memberAsItem);
    const patch = planItemMerge(memberAsItem(target), rest);
    return {
      ...g,
      targetId: target.id,
      victimIds: [...patch.victimIds],
      patch,
      targetTitle: target.title ?? target.url,
      victimTitles: rest.map((it) => it.title ?? it.url),
    };
  };

  const runRecategorizeAll = async () => {
    setConfirmRecatOpen(false);
    setRecatBusy(true);
    setRecatResult(null);
    setRecatProgress(null);
    try {
      // Yedek ZORUNLU: alınamazsa işlem başlamaz.
      await createBackup(await getDb());
      const allItems = await listItems();
      const res = await batchCategorizeItems(allItems, {
        forceAutoApply: true,
        replaceExisting: true,
        onProgress: (current, total, title) => setRecatProgress({ current, total, title }),
      });
      setRecatResult(
        `${res.applied} kayıt yeniden üretildi` +
          `${res.failed > 0 ? ` · ${res.failed} başarısız` : ''}. ` +
          'Eşik altı kalan kayıtlarda eski atamalar korundu.',
      );
    } catch (e) {
      setMaintenanceError(String(e));
    } finally {
      setRecatBusy(false);
      setRecatProgress(null);
    }
  };

  const runOrganizeUncategorized = async () => {
    setOrganizeBusy(true);
    setOrganizeResult(null);
    setOrganizeProgress(null);
    try {
      const allItems = await listItems();
      /* N+1 YOK: öğe başına 2 sorgu yerine toplam 2 sorgu. Ölçek farkı burada
         büyük — 2000 kayıtlık arşivde 4000 çağrı yerine 2. */
      const [tagsByItem, catsByItem] = await Promise.all([getAllTagsByItem(), getAllCategoriesByItem()]);
      const targetItems = allItems.filter(
        (item) => (catsByItem[item.id]?.length ?? 0) === 0 || (tagsByItem[item.id]?.length ?? 0) === 0,
      );

      if (targetItems.length === 0) {
        setOrganizeResult('Kategorisiz veya etiketsiz kayıt bulunamadı (tümü düzenli).');
        return;
      }

      const res = await batchCategorizeItems(targetItems, {
        forceAutoApply: true,
        onProgress: (current, total, title) => {
          setOrganizeProgress({ current, total, title });
        },
      });

      setOrganizeResult(
        `${res.applied} uygulandı · ${res.lowConfidence} düşük güvenle atlandı · ` +
          `${res.deterministic} LLM'siz eşleşti` +
          `${res.failed > 0 ? ` · ${res.failed} başarısız` : ''}` +
          `${res.skipped > 0 ? ` · ${res.skipped} öneri (uygulama kapalı)` : ''}.`,
      );
    } catch (e) {
      setMaintenanceError(String(e));
    } finally {
      setOrganizeBusy(false);
      setOrganizeProgress(null);
    }
  };

  const runAnalyzeMissing = async () => {
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisBusy(true);
    setAnalysisResult(null);
    setAnalysisProgress(null);
    try {
      const res = await analyzeMissing(
        (done, total) => setAnalysisProgress({ done, total }),
        controller.signal,
      );
      const parts = [`${res.processed} analiz edildi`];
      if (res.skipped > 0) parts.push(`${res.skipped} atlandı`);
      if (res.failed > 0) parts.push(`${res.failed} başarısız`);
      setAnalysisResult(`${controller.signal.aborted ? 'İptal edildi · ' : ''}${parts.join(' · ')}`);
      // Arşiv görünümü indeks tazelenince yeniden yüklenir.
      window.dispatchEvent(new CustomEvent('vault-items-updated'));
    } catch (e) {
      setMaintenanceError(String(e));
    } finally {
      analysisAbortRef.current = null;
      setAnalysisBusy(false);
      setAnalysisProgress(null);
    }
  };
  const runReindex = async () => {
    setReindexBusy(true);
    setReindexProgress({ current: 0, total: 100, phase: 'content' });
    try {
      await reindexVault((current, total, phase) => {
        setReindexProgress({ current, total, phase });
      });
    } catch (e) {
      setMaintenanceError(String(e));
    } finally {
      setReindexBusy(false);
      setReindexProgress(null);
    }
  };

  return (
    <>
    {/* 6. Arşiv Bakım & Düzenleme Araçları */}
    <div className="flex flex-col gap-3.5 settings-card p-4">
      <div>
        <p className="text-sm font-medium">Arşiv Bakım & Düzenleme Araçları</p>
        <p className="text-xs text-muted-foreground">
          Arşivdeki kayıtların taksonomisini ve vektör veritabanını toplu olarak yönetin.
        </p>
      </div>

      {/* Satır listesi: aynı sözlük */}
      <div className="flex flex-col divide-y divide-border/70">
        <SettingRow
          label="Öneri Güven Eşiği"
          hint="Bu eşiğin altındaki otomatik öneriler uygulanmaz; raporda 'atlandı' olarak görünür."
        >
          <Select
            value={String(tagThreshold)}
            onValueChange={handleThresholdChange}
            options={THRESHOLD_OPTIONS}
            label="Öneri güven eşiği"
            size="sm"
            className="w-24"
          />
        </SettingRow>

        <SettingRow
          label="Analiz Edilmemişleri Analiz Et"
          hint={
            <>
              {analysisProgress
                ? `${analysisProgress.done} / ${analysisProgress.total} analiz ediliyor…`
                : 'İndirilmiş ama içeriği analiz edilmemiş kayıtları sırayla tarar; transkript, özet, konu ve varsa tarif çıkarır.'}
              {analysisResult && (
                <span className="mt-1 block font-medium text-emerald-400">✓ {analysisResult}</span>
              )}
            </>
          }
        >
          {analysisBusy ? (
            <>
              <Progress
                value={analysisProgress && analysisProgress.total > 0 ? (analysisProgress.done / analysisProgress.total) * 100 : 0}
                className="w-28"
                label="Toplu analiz ilerlemesi"
              />
              <Button variant="outline" size="sm" onClick={() => analysisAbortRef.current?.abort()}>
                İptal
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runAnalyzeMissing()}
              disabled={!aiEnabled || !llmReady}
            >
              Analiz Et
            </Button>
          )}
        </SettingRow>

        <SettingRow
          label="Kategorisiz Kayıtları Düzenle"
          hint={
            <>
              {organizeProgress
                ? `${organizeProgress.current} / ${organizeProgress.total}: ${organizeProgress.title} işleniyor…`
                : 'Kategorisi veya etiketi olmayan kayıtları Qwen 2.5 ile sırayla tarar ve otomatik düzenler.'}
              {organizeResult && (
                <span className="mt-1 block font-medium text-emerald-400">✓ {organizeResult}</span>
              )}
            </>
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runOrganizeUncategorized()}
            disabled={organizeBusy || !aiEnabled || !llmReady}
          >
            {organizeBusy ? 'İşleniyor…' : 'Kategorisizleri Düzenle'}
          </Button>
        </SettingRow>

        <SettingRow
          label="Defteri Hazırla"
          hint={
            <>
              {defterStep ? defterStep : 'Eksik içerikleri toplar, kategorilendirir, tekrarları bulur. Birleştirme yalnız sizin onayınızla olur.'}
              {defterMsg && (
                <span className="mt-1 block font-medium text-emerald-400">✓ {defterMsg}</span>
              )}
              {defterError && (
                <span className="mt-1 block font-medium text-red-400">⚠️ {defterError}</span>
              )}
              {defterReport && (defterReport.dedupe?.missingEmbedding ?? 0) > 0 && (
                <span className="mt-1 block text-muted-foreground">
                  {defterReport.dedupe?.missingEmbedding} kayıt indekslenmemiş — 'Tüm Kayıtları Yeniden İndeksle' işini çalıştırın.
                </span>
              )}
              {defterReport && defterReport.scrapeFailures.length > 0 && (
                <span className="mt-1 block text-muted-foreground">
                  Başarısızlar: {defterReport.scrapeFailures.map((f) => f.title || f.url).join(' · ')}
                </span>
              )}
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runNotebook()}
              disabled={defterBusy}
            >
              {defterBusy ? 'Hazırlanıyor…' : 'Defteri Hazırla'}
            </Button>
            {defterBusy && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  notebookCancelRef.current = true;
                }}
              >
                İptal
              </Button>
            )}
            {defterReport && defterReport.scrapeFailures.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void retryFailedNotebook()}
                disabled={defterBusy}
              >
                Yeniden dene ({defterReport.scrapeFailures.length})
              </Button>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="Defter Tekrar Eşiği"
          hint="Bu benzerliğin üzerindeki kayıtlar tekrar grubu olur; eşik 0,80–0,98 arasında ayarlanır."
        >
          <Select
            value={String(dedupeThreshold)}
            onValueChange={handleDedupeThresholdChange}
            options={DEDUPE_THRESHOLD_OPTIONS}
            label="Defter tekrar eşiği"
            size="sm"
            className="w-24"
          />
        </SettingRow>

        {defterGroups.length > 0 && (
          <div className="flex flex-col gap-2 py-1">
            <p className="text-xs text-muted-foreground">
              Tekrar grupları ({defterGroups.length}): hedef kayıt + artıklar. Her grup için karar verin.
            </p>
            <ul className="flex flex-col gap-1">
              {defterGroups.map((g, i) => (
                <li key={`${g.targetId}-${i}`} className="flex flex-col gap-1 rounded-sm border border-border/50 bg-card/40 p-2">
                  {g.members.length > 2 && !defterDone[i] ? (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-3xs text-muted-foreground">Hedef kayıt:</span>
                      <Select
                        value={defterTargets[i] ?? g.targetId}
                        onValueChange={(v) => setDefterTargets((p) => ({ ...p, [i]: v }))}
                        options={g.members.map((m) => ({ value: m.id, label: m.title ?? m.url }))}
                        label="Birleştirme hedefi"
                        size="sm"
                        className="min-w-0 flex-1"
                      />
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{g.targetTitle}</span>
                      <span className="text-muted-foreground"> ← {g.victimTitles.join(', ')}</span>
                    </span>
                    {defterDone[i] ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {defterDone[i] === 'merged' ? 'birleşti' : 'atlandı'}
                      </span>
                    ) : (
                      <span className="flex shrink-0 gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => void mergeNotebookGroup(i)} disabled={defterBusy}>
                          Birleştir
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDefterDone((p) => ({ ...p, [i]: 'skipped' }))}
                          disabled={defterBusy}
                        >
                          Atla
                        </Button>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 text-3xs text-muted-foreground">
                    {g.members.map((m) => (
                      <span key={m.id} className="truncate">
                        {m.id === (defterTargets[i] ?? g.targetId) ? '→ ' : '· '}
                        {m.title || m.url} {m.author ? `(${m.author})` : ''} · {trDateLabel(m.created_at)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void mergeRemainingNotebook()}
              disabled={defterBusy}
            >
              {defterBusy ? 'Birleştiriliyor…' : 'Kalan Tümünü Birleştir'}
            </Button>
          </div>
        )}

        <SettingRow
          label="Tüm Kayıtları Yeniden Kategorize Et"
          hint={
            <>
              {recatProgress
                ? `${recatProgress.current} / ${recatProgress.total}: ${recatProgress.title} işleniyor…`
                : 'Her kaydın kategori/etiketi baştan üretilir. Önce otomatik yedek alınır; eşik altı kayıtlarda eski atamalar korunur.'}
              {recatResult && (
                <span className="mt-1 block font-medium text-emerald-400">✓ {recatResult}</span>
              )}
            </>
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmRecatOpen(true)}
            disabled={recatBusy || !aiEnabled || !llmReady}
          >
            {recatBusy ? 'Yeniden üretiliyor…' : 'Tümünü Yeniden Kategorize Et'}
          </Button>
        </SettingRow>

        <ConfirmDialog
          open={confirmRecatOpen}
          onOpenChange={setConfirmRecatOpen}
          title="Tüm kayıtlar yeniden kategorize edilsin mi?"
          description="Her kaydın mevcut kategori ve etiketleri, yeni üretilenlerle DEĞİŞTİRİLİR. İşlemden önce otomatik yedek alınır; geri dönmek istersen Yedekleme bölümünü kullanabilirsin."
          confirmLabel="Yeniden Kategorize Et"
          onConfirm={() => void runRecategorizeAll()}
        />

        <SettingRow
          label="Anlamsal Arşiv İndeksi"
          hint={
            reindexProgress
              ? `${reindexProgress.current} / ${reindexProgress.total} ${
                  reindexProgress.phase === 'content'
                    ? 'içerik kuruluyor…'
                    : 'vektörleştiriliyor…'
                }`
              : 'Not, transkript, makale ve künye parçalarını baştan kurup BGE-M3 ile vektörleştirir.'
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runReindex()}
            disabled={reindexBusy || !aiEnabled || !embedReady}
          >
            {reindexBusy ? 'İndeksleniyor…' : 'Tümünü Yeniden İndeksle'}
          </Button>
        </SettingRow>
      </div>
    </div>

    {maintenanceError && <p className="text-sm text-destructive">{maintenanceError}</p>}

    </>
  );
}
