import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Clapperboard, Loader2 } from 'lucide-react';
import { PageSurface } from '@/components/ui/page-surface';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { useNotice } from '@/components/ui/notice';
import { useComponentInstaller } from '@/components/ComponentInstaller';
import { ConversionSources } from '@/components/conversion/ConversionSources';
import { ConversionTarget } from '@/components/conversion/ConversionTarget';
import { ConversionJobs } from '@/components/conversion/ConversionJobs';
import { PdfTools } from '@/components/conversion/PdfTools';
import { ConversionHistory } from '@/components/conversion/ConversionHistory';
import type { ConversionSource, RunJobView } from '@/components/conversion/types';
import { listItems, recordConversionJob, updateItem } from '@/lib/db/client';
import { basenameOf } from '@/lib/convert-path';
import { toVaultSources } from '@/lib/vault-sources';
import {
  commonTargets,
  conversionOutputPath,
  defaultOptions,
  familyOfPath,
  optionsForTarget,
  requiredComponent,
  type ConversionOptions,
} from '@/lib/conversion';
import {
  cancelConversion,
  inspectConversionPaths,
  runConversion,
  scanConversionDir,
  useConversionProgress,
} from '@/lib/conversion-run';
import { isUsable, missingComponentText, parseMissingComponent, type ComponentStatus } from '@/lib/components';

const ALL_EXTENSIONS = [
  'pdf',
  'docx',
  'doc',
  'odt',
  'rtf',
  'txt',
  'html',
  'htm',
  'md',
  'markdown',
  'xlsx',
  'xls',
  'ods',
  'csv',
  'pptx',
  'ppt',
  'odp',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'gif',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wma',
  'aiff',
  'aif',
  'amr',
  'mp4',
  'm4v',
  'mkv',
  'webm',
  'mov',
  'avi',
  'wmv',
  'flv',
  'ts',
  'mts',
  'mpg',
  'mpeg',
  '3gp',
];

interface ConversionStudioProps {
  refreshKey: number;
  onDone: () => void;
}

type StudioTab = 'convert' | 'pdf' | 'history';

export function ConversionStudio({ refreshKey, onDone }: ConversionStudioProps) {
  const notice = useNotice();
  const installer = useComponentInstaller();
  const [tab, setTab] = useState<StudioTab>('convert');
  const [sources, setSources] = useState<ConversionSource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('pdf');
  const [options, setOptions] = useState<ConversionOptions>(defaultOptions);
  const [outputDir, setOutputDir] = useState<string | null>(() =>
    window.localStorage.getItem('jv-convert-outdir'),
  );
  const [jobs, setJobs] = useState<RunJobView[]>([]);
  const [running, setRunning] = useState(false);
  const [overallPercent, setOverallPercent] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);
  const currentJobRef = useRef<string | null>(null);
  const cancelAllRef = useRef(false);
  const totalRef = useRef(0);
  const completedRef = useRef(0);
  const gatingRef = useRef(false);

  useEffect(() => {
    let live = true;
    void listItems()
      .then((items) => {
        if (!live) return;
        const vault = toVaultSources(items).flatMap<ConversionSource>((source) => {
          const family = familyOfPath(source.inputPath);
          if (family === 'unknown') return [];
          const ext = source.inputPath.split('.').pop()?.toLowerCase() ?? '';
          return [
            {
              id: `vault:${source.itemId ?? source.inputPath}`,
              path: source.inputPath,
              name: basenameOf(source.inputPath),
              ext,
              family,
              size: null,
              origin: 'vault',
              itemId: source.itemId,
            },
          ];
        });
        setSources((previous) => [
          ...vault,
          ...previous.filter((source) => source.origin !== 'vault'),
        ]);
        void inspectConversionPaths(vault.map((source) => source.path)).then((info) => {
          if (!live || info.length === 0) return;
          const sizes = new Map(info.map((item) => [item.path, item.size]));
          setSources((previous) =>
            previous.map((source) =>
              sizes.has(source.path)
                ? { ...source, size: sizes.get(source.path) ?? source.size }
                : source,
            ),
          );
        });
      })
      .catch(() => {
        if (live) notice.push({ text: 'Arşiv kaynakları okunamadı.', tone: 'error' });
      });
    return () => {
      live = false;
    };
  }, [refreshKey, notice]);

  const selectedSources = useMemo(
    () => sources.filter((source) => selected.has(source.id)),
    [sources, selected],
  );
  const visibleSelected = useMemo(
    () => new Set([...selected].filter((id) => sources.some((source) => source.id === id))),
    [selected, sources],
  );
  const familiesKey = useMemo(
    () => [...new Set(selectedSources.map((source) => source.family))].sort().join(','),
    [selectedSources],
  );
  const families = useMemo(
    () => familiesKey.split(',').filter(Boolean) as ConversionSource['family'][],
    [familiesKey],
  );
  const allowedTargets = useMemo(
    () => commonTargets(families),
    [families],
  );
  const effectiveTarget =
    allowedTargets.length > 0 && !allowedTargets.some((item) => item.id === target)
      ? allowedTargets[0].id
      : target;

  useConversionProgress((event) => {
    if (event.jobId !== currentJobRef.current) return;
    setJobs((previous) =>
      previous.map((job) =>
        job.jobId === event.jobId
          ? { ...job, percent: event.percent, phase: event.phase }
          : job,
      ),
    );
    if (totalRef.current > 0) {
      setOverallPercent(
        ((completedRef.current + event.percent / 100) / totalRef.current) * 100,
      );
    }
  });

  const addPaths = useCallback(
    async (paths: string[], origin: 'external' | 'folder'): Promise<void> => {
      if (paths.length === 0) return;
      const info = await inspectConversionPaths(paths);
      const known = new Map(sources.map((source) => [source.path, source]));
      const additions: ConversionSource[] = [];
      const addedPaths = new Set<string>();
      for (const path of paths) {
        if (known.has(path) || addedPaths.has(path)) continue;
        const family = familyOfPath(path);
        if (family === 'unknown') continue;
        const ext = path.split('.').pop()?.toLowerCase() ?? '';
        const meta = info.find((item) => item.path === path);
        addedPaths.add(path);
        additions.push({
          id: `external:${path}`,
          path,
          name: basenameOf(path),
          ext,
          family,
          size: meta?.size ?? null,
          origin,
        });
      }
      if (additions.length === 0) return;
      setSources((previous) => [...previous, ...additions]);
      setSelected((previous) => new Set([...previous, ...additions.map((item) => item.id)]));
    },
    [sources],
  );

  const addFiles = useCallback(async (): Promise<void> => {
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: 'Desteklenen dosyalar', extensions: ALL_EXTENSIONS }],
      });
      if (!picked) return;
      await addPaths(Array.isArray(picked) ? picked : [picked], 'external');
    } catch {
      /* seçimden vazgeçme sessiz */
    }
  }, [addPaths]);

  const addFolder = useCallback(async (): Promise<void> => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      const found = await scanConversionDir(picked);
      const accepted = found.map((file) => file.path);
      if (accepted.length === 0) {
        notice.push({ text: 'Klasörde desteklenen dosya bulunamadı.', tone: 'info' });
        return;
      }
      await addPaths(accepted, 'folder');
      notice.push({ text: `${accepted.length} dosya eklendi.`, tone: 'ok' });
    } catch {
      /* vazgeçme sessiz */
    }
  }, [addPaths, notice]);

  const toggle = useCallback((id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]): void => {
    setSelected((previous) => {
      const all = ids.length > 0 && ids.every((id) => previous.has(id));
      if (all) {
        const next = new Set(previous);
        for (const id of ids) next.delete(id);
        return next;
      }
      return new Set([...previous, ...ids]);
    });
  }, []);

  const remove = useCallback((id: string): void => {
    setSources((previous) => previous.filter((source) => source.id !== id));
    setSelected((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const pickOutputDir = useCallback(async (): Promise<void> => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      setOutputDir(picked);
      window.localStorage.setItem('jv-convert-outdir', picked);
    } catch {
      /* vazgeçme sessiz */
    }
  }, []);

  const clearOutputDir = useCallback((): void => {
    setOutputDir(null);
    window.localStorage.removeItem('jv-convert-outdir');
  }, []);

  const buildJobs = useCallback((): RunJobView[] => {
    return selectedSources.map((source) => {
      const outputPath = conversionOutputPath(source.path, effectiveTarget, outputDir);
      return {
        id: `${source.id}:${effectiveTarget}`,
        name: source.name,
        path: source.path,
        target: effectiveTarget,
        status: 'queued' as const,
        percent: 0,
        phase: 'kuyrukta',
        outputs: [],
        warnings: [],
        outputPath,
        options: optionsForTarget(source.family, effectiveTarget, options),
        itemId: source.itemId,
        family: source.family,
      };
    });
  }, [selectedSources, effectiveTarget, outputDir, options]);

  const runJobs = useCallback(
    async (snapshot: RunJobView[]): Promise<void> => {
      if (snapshot.length === 0) return;
      setTab('convert');
      setRunning(true);
      setOverallPercent(0);
      setJobs(snapshot);
      cancelAllRef.current = false;
      totalRef.current = snapshot.length;
      completedRef.current = 0;

      for (let index = 0; index < snapshot.length; index += 1) {
        if (cancelAllRef.current) {
          setJobs((previous) =>
            previous.map((job, jobIndex) =>
              jobIndex >= index && job.status === 'queued'
                ? { ...job, status: 'cancelled', phase: 'iptal' }
                : job,
            ),
          );
          break;
        }
        const job = snapshot[index];
        const jobId = crypto.randomUUID();
        currentJobRef.current = jobId;
        setJobs((previous) =>
          previous.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, jobId, status: 'running', percent: 0, phase: 'hazırlanıyor' }
              : item,
          ),
        );

        const result = await runConversion({
          jobId,
          inputPath: job.path,
          outputPath: job.outputPath,
          target: job.target,
          options: job.options,
        });
        currentJobRef.current = null;

        if (result.ok) {
          if (job.itemId && result.outputs[0]) {
            try {
              await updateItem(job.itemId, { converted_path: result.outputs[0] });
            } catch {
              notice.push({
                text: 'Dosya dönüştü ama arşiv kaydı güncellenemedi.',
                tone: 'error',
              });
            }
          }
          try {
            await recordConversionJob({
              id: result.jobId,
              inputPath: job.path,
              outputPaths: result.outputs,
              target: job.target,
              sourceKind: job.family,
              status: 'done',
            });
          } catch {
            notice.push({ text: 'Dönüşüm geçmişi yazılamadı.', tone: 'info' });
          }
          setJobs((previous) =>
            previous.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    status: 'done',
                    percent: 100,
                    phase: 'tamamlandı',
                    outputs: result.outputs,
                    warnings: result.warnings,
                  }
                : item,
            ),
          );
          for (const warning of result.warnings) {
            notice.push({ text: warning, tone: 'info' });
          }
        } else if (result.cancelled) {
          try {
            await recordConversionJob({
              id: result.jobId,
              inputPath: job.path,
              outputPaths: [],
              target: job.target,
              sourceKind: job.family,
              status: 'cancelled',
            });
          } catch {
            /* geçmiş yazımı başarısızsa iş sonucu değişmez */
          }
          setJobs((previous) =>
            previous.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, status: 'cancelled', phase: 'iptal' }
                : item,
            ),
          );
        } else {
          const message = result.error ?? 'Dönüştürme başarısız.';
          const missing = parseMissingComponent(message);
          const shown = missing ? missingComponentText(missing) : message;
          try {
            await recordConversionJob({
              id: result.jobId,
              inputPath: job.path,
              outputPaths: [],
              target: job.target,
              sourceKind: job.family,
              status: 'error',
              error: shown,
            });
          } catch {
            /* geçmiş yazımı başarısızsa iş sonucu değişmez */
          }
          setJobs((previous) =>
            previous.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    status: 'error',
                    phase: 'hata',
                    error: shown,
                  }
                : item,
            ),
          );
        }

        completedRef.current = index + 1;
        setOverallPercent((completedRef.current / totalRef.current) * 100);
        if (cancelAllRef.current) {
          setJobs((previous) =>
            previous.map((item, itemIndex) =>
              itemIndex > index && item.status === 'queued'
                ? { ...item, status: 'cancelled', phase: 'iptal' }
                : item,
            ),
          );
          break;
        }
      }

      setRunning(false);
      setHistoryKey((value) => value + 1);
      onDone();
    },
    [notice, onDone],
  );

  const engineStatuses = useCallback(async (): Promise<ComponentStatus[] | null> => {
    try {
      return await invoke<ComponentStatus[]>('components_status');
    } catch {
      notice.push({ text: 'Bileşen durumu okunamadı.', tone: 'error' });
      return null;
    }
  }, [notice]);

  const execute = useCallback(
    async (snapshot: RunJobView[]): Promise<void> => {
      if (snapshot.length === 0 || gatingRef.current) return;
      gatingRef.current = true;
      try {
        const needed = new Set(
          snapshot
            .map((job) => requiredComponent(job.family, job.target))
            .filter((id): id is 'libreoffice' | 'pdfium' | 'ffmpeg' => id !== null),
        );
        for (const componentId of needed) {
          const rows = await engineStatuses();
          if (!rows) return;
          const row = rows.find((item) => item.id === componentId);
          if (row && isUsable(row)) continue;
          if (!row || !row.downloadable) {
            notice.push({
              text: missingComponentText({ id: componentId, detail: '' }),
              tone: 'error',
            });
            return;
          }
          const outcome = await installer.request(componentId, () => {
            void execute(snapshot);
          });
          if (outcome === 'unavailable') {
            notice.push({
              text: missingComponentText({ id: componentId, detail: '' }),
              tone: 'error',
            });
          }
          return;
        }
        await runJobs(snapshot);
      } finally {
        gatingRef.current = false;
      }
    },
    [engineStatuses, installer, notice, runJobs],
  );

  const startRun = useCallback((): void => {
    if (running) return;
    const snapshot = buildJobs();
    if (snapshot.length === 0) {
      notice.push({ text: 'Önce en az bir kaynak seç.', tone: 'info' });
      return;
    }
    void execute(snapshot);
  }, [buildJobs, execute, notice, running]);

  const cancelAll = useCallback((): void => {
    cancelAllRef.current = true;
    if (currentJobRef.current) void cancelConversion(currentJobRef.current);
  }, []);

  const outputPreview = selectedSources[0]
    ? conversionOutputPath(selectedSources[0].path, effectiveTarget, outputDir)
    : '';

  // Ctrl/Cmd+Enter: dönüştürme sekmesindeyken birincil eylemi klavyeden çalıştır.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      if (tab !== 'convert' || running) return;
      // Açık bir diyalog varken kısayol arka planda iş başlatmaz.
      if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')) {
        return;
      }
      event.preventDefault();
      startRun();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, running, startRun]);

  return (
    <PageSurface
      icon={<Clapperboard />}
      title="Dönüştürücü"
      description="Belge, PDF, görsel, ses ve videoyu yerelde dönüştür; çıktı arşive döner."
      width="6xl"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as StudioTab)}
        className="gap-3"
      >
        <TabsList>
          <TabsTab value="convert">
            {running && <Loader2 className="animate-spin" aria-hidden />}
            Dönüştür
            {running && <span className="sr-only">— dönüşüm sürüyor</span>}
          </TabsTab>
          <TabsTab value="pdf">PDF araçları</TabsTab>
          <TabsTab value="history">Geçmiş</TabsTab>
        </TabsList>

        <TabsPanel value="convert">
          <div className="studio-bench">
            <div className="studio-grid">
              <ConversionSources
                sources={sources}
                selected={visibleSelected}
                busy={running}
                onToggle={toggle}
                onSelectAll={selectAll}
                onRemove={remove}
                onAddFiles={() => void addFiles()}
                onAddFolder={() => void addFolder()}
              />
              <ConversionTarget
                families={families}
                target={effectiveTarget}
                selectedCount={selectedSources.length}
                options={options}
                outputPreview={outputPreview}
                outputDir={outputDir}
                running={running}
                overallPercent={overallPercent}
                onTargetChange={setTarget}
                onOptionsChange={(patch) =>
                  setOptions((previous) => ({ ...previous, ...patch }))
                }
                onPickOutputDir={() => void pickOutputDir()}
                onClearOutputDir={clearOutputDir}
                onRun={startRun}
                onCancel={cancelAll}
              />
              <ConversionJobs jobs={jobs} running={running} />
            </div>
          </div>
        </TabsPanel>

        <TabsPanel value="pdf">
          <PdfTools
            onDone={() => {
              onDone();
              setHistoryKey((value) => value + 1);
            }}
          />
        </TabsPanel>

        <TabsPanel value="history">
          <ConversionHistory refreshKey={historyKey} />
        </TabsPanel>
      </Tabs>
    </PageSurface>
  );
}
