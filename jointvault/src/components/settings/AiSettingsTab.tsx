import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Stamp } from '@/components/ui/stamp';
import { Switch } from '@/components/ui/switch';
import {
  downloadAiEngine,
  downloadAiModel,
  getAiStatus,
  isAiEnabled,
  saveAiConfig,
  stopAiServer,
  useAiEngineProgress,
  useAiModelProgress,
  useAiWarmupStatus,
  warmupAi,
  type AiGpuInfo,
  type AiStatus,
} from '@/lib/ai';
import { downloadComponent, type ComponentStatus } from '@/lib/components';
import { IDLE_OPTIONS } from './options';
import { AiMaintenanceSection } from './AiMaintenanceSection';

const MB_PER_GB = 1024;

/** MiB → okunur birim. 1024'ün altı MB kalır; uydurma yuvarlama yok. */
function formatMb(mb: number): string {
  return mb >= MB_PER_GB ? `${(mb / MB_PER_GB).toFixed(1)} GB` : `${mb} MB`;
}

/*
 * Donanım satırı: YALNIZCA tespit edileni söyler.
 * Hiçbir dalda uydurma sayı yoktur.
 */
function gpuHardwareLine(gpu: AiGpuInfo | undefined): string {
  if (!gpu || (gpu.name === null && gpu.vram_mb === null)) {
    return 'GPU bilinmiyor — nvidia-smi ve WMI sonuç vermedi.';
  }
  if (gpu.name !== null && gpu.vram_mb !== null) {
    return `${gpu.name} · ${formatMb(gpu.vram_mb)} VRAM (kaynak: ${gpu.source})`;
  }
  if (gpu.name !== null) {
    return `${gpu.name} · VRAM okunamadı (WMI yalnızca ad verir).`;
  }
  if (gpu.vram_mb !== null) {
    return `GPU adı okunamadı · ${formatMb(gpu.vram_mb)} VRAM (kaynak: ${gpu.source})`;
  }
  return 'GPU bilinmiyor — nvidia-smi ve WMI sonuç vermedi.';
}

const AI_COMPONENT_ITEMS: readonly { id: string; role: string; optional?: boolean }[] = [
  { id: 'llama-engine', role: 'AI motoru (llama-server)' },
  { id: 'llama-cudart', role: 'CUDA çalışma zamanı (GPU hızlandırma)', optional: true },
  { id: 'llama-engine-cuda', role: 'llama-server CUDA motoru (NVIDIA)', optional: true },
  { id: 'ai-model-embed', role: 'BGE-M3 anlamsal gömme modeli' },
];

const CHAT_MODELS: readonly { id: string; label: string }[] = [
  { id: 'ai-model-llm-3b', label: 'Qwen 2.5 3B (sohbet)' },
  { id: 'ai-model-llm-7b', label: 'Qwen 2.5 7B (sohbet)' },
  { id: 'ai-model-llm', label: 'Qwen 2.5 14B (sohbet)' },
];

export function AiSettingsTab() {
  const [componentSizes, setComponentSizes] = useState<Record<string, number | undefined>>({});
  /* id → kurulu dosya yolu: model seçimi `llm_path`'e bu yolu yazar (tek kaynak). */
  const [componentPaths, setComponentPaths] = useState<Record<string, string>>({});

  // Yerel AI (Qwen 2.5 14B + BGE-M3 + llama-server)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiEngineJob, setAiEngineJob] = useState<string | null>(null);
  const [aiModelJob, setAiModelJob] = useState<string | null>(null);
  const [aiModelType, setAiModelType] = useState<'llm' | 'embed' | null>(null);
  /* Sohbet modeli kurulumu (satır içi; tek indirme motoru `downloadComponent`). */
  const [chatJob, setChatJob] = useState<{ id: string; jobId: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // Ana anahtar (`enabled`) yazımı ve açık rıza onayı: indirme DEĞİL, tercih.
  const [aiConfigBusy, setAiConfigBusy] = useState(false);
  const [aiConfirm, setAiConfirm] = useState<'enable' | 'disable' | null>(null);
  const aiEnginePct = useAiEngineProgress(aiEngineJob);
  const aiModelPct = useAiModelProgress(aiModelJob);
  const chatModelPct = useAiModelProgress(chatJob?.jobId ?? null);

  const refreshComponentStatus = useCallback(async (): Promise<void> => {
    try {
      const rows = await invoke<ComponentStatus[]>('components_status');
      const sizes: Record<string, number> = {};
      const paths: Record<string, string> = {};
      for (const row of rows) {
        sizes[row.id] = row.approx_mb;
        if (row.path) paths[row.id] = row.path;
      }
      setComponentSizes(sizes);
      setComponentPaths(paths);
    } catch {
      setComponentSizes({});
      setComponentPaths({});
    }
  }, []);
  useEffect(() => {
    void getAiStatus().then(setAiStatus).catch(() => null);
    void refreshComponentStatus();
  }, [refreshComponentStatus]);

  const refreshAi = async () => {
    try {
      const s = await getAiStatus();
      setAiStatus(s);
    } catch (e) {
      setAiError(String(e));
    }
  };

  const runDownloadAiEngine = async () => {
    setAiError(null);
    const jid = crypto.randomUUID();
    setAiEngineJob(jid);
    try {
      await downloadAiEngine(jid);
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiEngineJob(null);
    }
  };

  const runDownloadAiModel = async (type: 'llm' | 'embed') => {
    setAiError(null);
    const jid = crypto.randomUUID();
    setAiModelJob(jid);
    setAiModelType(type);
    try {
      await downloadAiModel(type, jid);
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiModelJob(null);
      setAiModelType(null);
    }
  };

  const pickAiModelFile = async (type: 'llm' | 'embed') => {
    setAiError(null);
    try {
      const selected = await openDialog({
        title: type === 'llm' ? 'Sohbet Modeli (.gguf)' : 'BGE-M3 Vektör Modeli (.gguf)',
        multiple: false,
        filters: [{ name: 'GGUF Model', extensions: ['gguf'] }],
      });
      if (typeof selected === 'string' && selected.length > 0) {
        if (type === 'llm') {
          await saveAiConfig({ llm_path: selected });
        } else {
          await saveAiConfig({ embed_path: selected });
        }
        await refreshAi();
      }
    } catch (e) {
      setAiError(String(e));
    }
  };

  /* Kayıtlı sohbet modelini seç: yolu `llm_path`'e yaz (backend çözümlemesi buradan). */
  const selectChatModel = async (id: string): Promise<void> => {
    const path = componentPaths[id];
    if (!path) return;
    setAiError(null);
    try {
      await saveAiConfig({ llm_path: path });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  /* Kurulu olmayan sohbet modelini indir (tek motor: `downloadComponent`). */
  const installChatModel = async (id: string): Promise<void> => {
    if (chatJob) return;
    setAiError(null);
    const jobId = crypto.randomUUID();
    setChatJob({ id, jobId });
    try {
      const res = await downloadComponent(id, jobId);
      if (!res.ok) {
        setAiError(res.error ?? 'Model indirilemedi.');
        return;
      }
      await refreshComponentStatus();
      await refreshAi();
    } finally {
      setChatJob(null);
    }
  };

  const pickAiEngineFile = async () => {
    setAiError(null);
    try {
      const selected = await openDialog({
        title: 'llama-server.exe Dosyası',
        multiple: false,
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      });
      if (typeof selected === 'string' && selected.length > 0) {
        await saveAiConfig({ engine_path: selected });
        await refreshAi();
      }
    } catch (e) {
      setAiError(String(e));
    }
  };

  const [warmupBusy, setWarmupBusy] = useState(false);
  const warmupStatus = useAiWarmupStatus();

  const runWarmupAi = async () => {
    setAiError(null);
    setWarmupBusy(true);
    try {
      await warmupAi();
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setWarmupBusy(false);
    }
  };

  const handleToggleAutoWarmup = async (enabled: boolean) => {
    try {
      await saveAiConfig({ auto_warmup: enabled });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const handleChangeIdleTimeout = async (secs: number) => {
    try {
      await saveAiConfig({ idle_timeout_secs: secs });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const handleToggleAutoApply = async (enabled: boolean) => {
    try {
      setAiStatus((prev) => (prev ? { ...prev, auto_apply_tags: enabled } : prev));
      await saveAiConfig({ auto_apply_tags: enabled });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const handleChangeTemperature = async (temp: number) => {
    try {
      setAiStatus((prev) => (prev ? { ...prev, temperature: temp } : prev));
      await saveAiConfig({ temperature: temp });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };




  const runStopAi = async () => {
    try {
      await stopAiServer();
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  /*
   * `enabled` ANA anahtardır: yalnızca özelliği açar/kapatır. İNDİRME BAŞLATMAZ ve
   * süreç çalıştırmaz (Rust `ai_save_config` yalnızca yapılandırmayı yazar).
   * `auto_warmup` bu karara GİRMEZ; o ayrı bir ön yükleme tercihidir.
   */
  const runSetAiEnabled = async (enabled: boolean): Promise<void> => {
    setAiError(null);
    setAiConfigBusy(true);
    try {
      // Yalnızca ana anahtar yazılır; `ai_save_config` indirme/süreç başlatmaz.
      await saveAiConfig({ enabled });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiConfigBusy(false);
    }
  };


  const sizeSuffix = (id: string, fallbackMb?: number): string => {
    const mb = componentSizes[id] ?? fallbackMb;
    return mb === undefined ? '' : ` (~${mb} MB)`;
  };

  /*
   * Bir dosya yolunun boyutu, kayıttan (id → approx_mb) bulunur. Serbest GGUF
   * kayıtlı bir dosyayla çakışmıyorsa `undefined` döner; uydurma sayı yazılmaz.
   */
  const componentMbForPath = (path: string): number | undefined => {
    for (const [id, p] of Object.entries(componentPaths)) {
      if (p === path) return componentSizes[id];
    }
    return undefined;
  };
  // Yerel AI görünümü: etkinlik kararı TEK yerden (`isAiEnabled`, fail-closed).
  const aiEnabled = isAiEnabled(aiStatus);
  const aiGpu = aiStatus?.gpu;
  const aiOffload = aiStatus?.offload;

  /*
   * Seçili sohbet modeli: `llm_path` kayıtlı bir modelin YOLUYLA eşleşiyorsa o id,
   * aksi hâlde null (serbest GGUF). Karşılaştırma YOL üzerinden yapılır çünkü
   * backend de `llm_path`'i yolla çözer.
   */
  const llmPath = aiStatus?.llm_path ?? null;
  const selectedChatModelId = llmPath
    ? CHAT_MODELS.find((m) => componentPaths[m.id] === llmPath)?.id ?? null
    : null;
  /* Serbest GGUF: kayıtlı bir modelle eşleşmeyen, doğrulanmamış bir yol. */
  const freeGgufSelected =
    llmPath !== null && selectedChatModelId === null && aiStatus?.llm_verified !== true;
  const freeGgufSize = freeGgufSelected ? componentMbForPath(llmPath) : undefined;

  /*
   * Rıza metninin toplamı KAYITTAN toplanır. Eksik boyut varsa toplam GÖSTERİLMEZ:
   * yarım toplamı "küçük bir indirme" gibi göstermek yanlış olurdu (uydurma sayı).
   */
  /*
   * Rıza listesi: motor + gömme ZORUNLU, CUDA opsiyonel. Sohbet modeli satırları
   * SEÇİLİ modele göre işaretlenir — 14B'yi dayatmaz (M-2); seçim yoksa en hafif
   * (3B) zorunlu sayılır. Boyut her satırda KAYITTAN gelir.
   */
  const activeChatModelId = freeGgufSelected ? null : (selectedChatModelId ?? 'ai-model-llm-3b');
  const chatModelRows = CHAT_MODELS.map((model) => ({
    id: model.id,
    role: model.label,
    optional: model.id !== activeChatModelId,
    mb: componentSizes[model.id],
  }));
  const aiComponentRows = [
    ...AI_COMPONENT_ITEMS.map((item) => ({ ...item, mb: componentSizes[item.id] })),
    ...chatModelRows,
  ];
  /* Toplam YALNIZCA zorunlu satırlardan: CUDA ve seçili olmayan sohbet modelleri opsiyoneldir. */
  const aiRequiredRows = aiComponentRows.filter((row) => !row.optional);
  const aiSizesComplete = aiRequiredRows.every((row) => row.mb !== undefined);
  const aiTotalLabel = aiSizesComplete
    ? `≈ ${formatMb(aiRequiredRows.reduce((sum, row) => sum + (row.mb ?? 0), 0))}`
    : 'boyut bilgisi yükleniyor…';

  const aiServerRunning = aiStatus?.chat_server_running === true || aiStatus?.embed_server_running === true;
  const offloadTarget = aiOffload?.mode === 'gpu' ? "VRAM'e (GPU)" : 'belleğe (CPU)';
  const aiStatusLine =
    warmupStatus.status === 'loading'
      ? `🟡 Modeller ${offloadTarget} yükleniyor (ısıtılıyor)…`
      : aiServerRunning
        ? aiOffload?.mode === 'gpu'
          ? `🟢 Çalışıyor — tüm katmanlar GPU'da (${aiOffload.n_gpu_layers} katman)`
          : "🟢 Çalışıyor — CPU'da (VRAM kullanılmıyor)"
        : '⚪ Uyku Modunda — sunucu kapalı';
  return (
  <>
  <div className="flex flex-col gap-4">
    {/* 0. Açık rıza: Yerel AI'yı etkinleştir / kapat */}
    <div className="flex flex-col gap-3 settings-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Yerel AI</p>
          <p className="text-xs text-muted-foreground">
            {aiEnabled
              ? 'Etkin. Asistan ve anlamsal arama kullanılabilir.'
              : 'Kapalı. Asistan ve anlamsal arama bu anahtar açılmadan çalışmaz.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aiEnabled ? <Stamp state="local">etkin</Stamp> : <Stamp state="none">kapalı</Stamp>}
          <Button
            variant={aiEnabled ? 'outline' : 'default'}
            size="sm"
            disabled={aiConfigBusy}
            onClick={() => setAiConfirm(aiEnabled ? 'disable' : 'enable')}
          >
            {aiConfigBusy ? 'Kaydediliyor…' : aiEnabled ? "Yerel AI'yı kapat" : "Yerel AI'yı etkinleştir"}
          </Button>
        </div>
      </div>

      {/* Rıza metni: kullanıcı ONAYLAMADAN önce ne indirileceğini ve toplamı görür. */}
      {!aiEnabled && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">
            Etkinleştirmek <span className="font-medium text-foreground">hiçbir şey indirmez</span>; yalnızca
            özelliği açar. Gerekli dosyalar inene kadar asistan yanıt veremez. İndirmeyi sen başlatırsın
            (aşağıdaki düğmeler veya Ayarlar → Bileşenler); kurulu bileşenler yeniden indirilmez.
          </p>
          <ul className="flex flex-col gap-1">
            {aiComponentRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {row.role}
                  {row.optional ? ' · opsiyonel' : ''}
                </span>
                <span className="font-mono text-2xs text-foreground">
                  {row.mb !== undefined ? formatMb(row.mb) : 'boyut okunamadı'}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2 text-xs">
            <span className="text-muted-foreground">Gerekli toplam indirme</span>
            <span className="font-mono text-xs font-medium">{aiTotalLabel}</span>
          </div>
        </div>
      )}
    </div>

    {/* Donanım tespiti + offload kararı: sabit metin YOK, tespit ne ise o yazılır. */}
    <div className="flex items-start justify-between gap-3 settings-card p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Yerel Donanım Hızlandırma</p>
        <p className="text-xs text-muted-foreground">{gpuHardwareLine(aiGpu)}</p>
        <p className="text-xs text-muted-foreground">
          Offload kararı: {aiOffload?.reason ?? 'okunamadı (tespit yok).'}
        </p>
      </div>
      <Stamp state={aiOffload?.mode === 'gpu' ? 'local' : 'none'}>
        {aiOffload
          ? aiOffload.mode === 'gpu'
            ? `GPU · ${aiOffload.n_gpu_layers} katman`
            : 'CPU'
          : 'bilinmiyor'}
      </Stamp>
    </div>

    {/* 1. AI Motoru */}
    <div className="flex flex-col gap-2 settings-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-sm font-medium">AI Motoru (llama-server)</span>
          <p className="text-xs text-muted-foreground">Yerel inference sunucusu{sizeSuffix('llama-engine')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aiStatus?.engine_available ? (
            <Stamp state="local">kurulu</Stamp>
          ) : (
            <Stamp state="none">eksik</Stamp>
          )}
          {!aiStatus?.engine_available && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runDownloadAiEngine()}
              disabled={aiEngineJob !== null}
            >
              {aiEngineJob ? (aiEnginePct !== null && aiEnginePct >= 0 ? `%${Math.round(aiEnginePct)}` : '…') : 'İndir'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void pickAiEngineFile()}>
            Seç (.exe)
          </Button>
        </div>
      </div>
      {aiEngineJob && (
        <div className="h-1.5 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-primary transition-[width]"
            style={{ width: `${aiEnginePct !== null && aiEnginePct >= 0 ? Math.round(aiEnginePct) : 100}%` }}
          />
        </div>
      )}
      {aiStatus?.engine_path && (
        <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.engine_path}>
          {aiStatus.engine_path}
        </p>
      )}
    </div>

    {/* 2. Sohbet Modeli — 3B/7B/14B sabit hat + serbest GGUF ("doğrulanmadı") */}
    <div className="flex flex-col gap-3 settings-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">Sohbet Modeli</span>
          <p className="text-xs text-muted-foreground">
            Asistan ve özetleme için kullanılan model. Seçim kalıcıdır; boyutlar bileşen
            kaydından okunur.
          </p>
        </div>
        <div className="shrink-0">
          {aiStatus?.llm_ready ? (
            <Stamp state="local">hazır</Stamp>
          ) : (
            <Stamp state="none">eksik</Stamp>
          )}
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border/70">
        {CHAT_MODELS.map((m) => {
          const installed = componentPaths[m.id] !== undefined;
          const selected = selectedChatModelId === m.id;
          const installing = chatJob?.id === m.id;
          const mb = componentSizes[m.id];
          return (
            <SettingRow
              key={m.id}
              label={m.label}
              hint={
                mb !== undefined
                  ? `${installed ? 'kurulu' : 'indirilecek'} · ${formatMb(mb)}`
                  : installed
                    ? 'kurulu'
                    : 'boyut okunamadı'
              }
            >
              {selected && <Stamp state="local">seçili</Stamp>}
              {installed ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected}
                  onClick={() => void selectChatModel(m.id)}
                >
                  Seç
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={chatJob !== null}
                  onClick={() => void installChatModel(m.id)}
                >
                  {installing
                    ? chatModelPct !== null && chatModelPct >= 0
                      ? `%${Math.round(chatModelPct)}`
                      : '…'
                    : 'Kur'}
                </Button>
              )}
            </SettingRow>
          );
        })}

        <SettingRow
          label="Serbest GGUF"
          hint={
            freeGgufSelected
              ? `Seçili dosya: ${aiStatus?.llm_label ?? 'ad okunamadı'}`
              : 'Kayıtlı olmayan bir .gguf dosyası seç. Doğrulanmadığı damgayla belirtilir.'
          }
        >
          {freeGgufSelected && <Stamp state="none">doğrulanmadı</Stamp>}
          {freeGgufSize !== undefined && (
            <span className="font-mono text-2xs text-muted-foreground">{formatMb(freeGgufSize)}</span>
          )}
          <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('llm')}>
            Diskten Seç
          </Button>
        </SettingRow>
      </div>

      {aiStatus?.llm_path && (
        <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.llm_path}>
          {aiStatus.llm_path}
        </p>
      )}
    </div>

    {/* 3. Embedding Modeli */}
    <div className="flex flex-col gap-2 settings-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-sm font-medium">BGE-M3 Vektör Modeli</span>
          <p className="text-xs text-muted-foreground">Türkçe & Çok Dilli Anlamsal İndeksleme{sizeSuffix('ai-model-embed')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aiStatus?.embed_ready ? (
            <Stamp state="local">hazır</Stamp>
          ) : (
            <Stamp state="none">eksik</Stamp>
          )}
          {!aiStatus?.embed_ready && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runDownloadAiModel('embed')}
              disabled={aiModelJob !== null}
            >
              {aiModelJob && aiModelType === 'embed'
                ? (aiModelPct !== null && aiModelPct >= 0 ? `%${Math.round(aiModelPct)}` : '…')
                : 'HF İndir'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('embed')}>
            Diskten Seç (.gguf)
          </Button>
        </div>
      </div>
      {aiModelJob && aiModelType === 'embed' && (
        <div className="h-1.5 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-primary transition-[width]"
            style={{ width: `${aiModelPct !== null && aiModelPct >= 0 ? Math.round(aiModelPct) : 100}%` }}
          />
        </div>
      )}
      {aiStatus?.embed_path && (
        <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.embed_path}>
          {aiStatus.embed_path}
        </p>
      )}
    </div>

    {/* 4. VRAM & Sunucu Durumu */}
    <div className="flex flex-col gap-3.5 settings-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Çalışma Durumu & Hızlandırma</p>
          <p className="text-xs text-muted-foreground">{aiStatusLine}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Chat: {aiStatus?.chat_server_running ? '🟢' : '⚪'} | Embed: {aiStatus?.embed_server_running ? '🟢' : '⚪'}
          </span>
          {aiServerRunning ? (
            <Button variant="outline" size="sm" onClick={() => void runStopAi()}>
              {aiOffload?.mode === 'gpu' ? "VRAM'i Boşalt" : 'Sunucuyu Durdur'}
            </Button>
          ) : (
            aiStatus?.llm_ready && aiStatus?.embed_ready && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runWarmupAi()}
                disabled={warmupBusy || warmupStatus.status === 'loading'}
              >
                {warmupBusy || warmupStatus.status === 'loading'
                  ? 'Yükleniyor…'
                  : aiOffload?.mode === 'gpu'
                    ? "VRAM'e Yükle (Isıt)"
                    : 'Belleğe Yükle (Isıt)'}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Açılışta Otomatik Isıtma / Warmup + Boşta Kalma: tek satır listesi */}
      <div className="flex flex-col divide-y divide-border/70">
        <SettingRow
          label="Açılışta Otomatik Başlat (Warmup)"
          hint={`Yerel AI açıkken uygulama başlarken modelleri arka planda ${offloadTarget} yükler; ilk sorunuz anında yanıtlanır. Bu AYRI bir ön yükleme tercihidir — kapatmak Yerel AI'yı kapatmaz.`}
        >
          <Switch
            checked={aiStatus?.auto_warmup ?? true}
            onCheckedChange={(checked) => void handleToggleAutoWarmup(checked)}
          />
        </SettingRow>

        <SettingRow
          label="Boşta Kalma Süresi (Uyku Modu)"
          hint={`Belirtilen süre işlem yapılmazsa ${aiOffload?.mode === 'gpu' ? 'VRAM' : 'model belleği'} otomatik boşaltılır.`}
        >
          <div className="w-56">
            <Select
              label="Boşta Kalma Süresi"
              size="sm"
              options={IDLE_OPTIONS}
              value={String(aiStatus?.idle_timeout_secs ?? 600)}
              onValueChange={(val) => void handleChangeIdleTimeout(Number(val))}
            />
          </div>
        </SettingRow>
      </div>
    </div>

    {/* 5. Akıllı Taksonomi & Otomasyon */}
    <div className="flex flex-col gap-3.5 settings-card p-4">
      <div>
        <p className="text-sm font-medium">Akıllı Taksonomi & Otomasyon</p>
        <p className="text-xs text-muted-foreground">
          Qwen 2.5'in içerikleri sınıflandırma ve etiketleme davranışlarını yapılandırın.
        </p>
      </div>

      {/* Satır listesi: tek sözlük */}
      <div className="flex flex-col divide-y divide-border/70">
        <SettingRow
          label="Önerileri Otomatik Uygula"
          hint="Yeni kayıt eklendiğinde veya altyazı çıkarıldığında AI önerilerini sormadan arşive kaydeder."
        >
          <Switch
            checked={aiStatus?.auto_apply_tags ?? false}
            onCheckedChange={(checked) => void handleToggleAutoApply(checked)}
          />
        </SettingRow>

        <SettingRow
          label={`AI Yanıt Sıcaklığı (Temperature: ${aiStatus?.temperature ?? 0.7})`}
          hint="Düşük değerler daha kesin/tutarlı, yüksek değerler daha yaratıcı öneriler ve yanıtlar üretir."
        >
          <div className="w-48">
            <Select
              label="AI Sıcaklığı"
              size="sm"
              options={[
                { value: '0.2', label: '0.2 (Kesin & Katı)' },
                { value: '0.5', label: '0.5 (Odaklı)' },
                { value: '0.7', label: '0.7 (Dengeli - Varsayılan)' },
                { value: '0.9', label: '0.9 (Yaratıcı & Esnek)' },
              ]}
              value={String(aiStatus?.temperature ?? 0.7)}
              onValueChange={(val) => void handleChangeTemperature(Number(val))}
            />
          </div>
        </SettingRow>
      </div>
    </div>

    <AiMaintenanceSection
      aiEnabled={aiEnabled}
      llmReady={aiStatus?.llm_ready === true}
      embedReady={aiStatus?.embed_ready === true}
    />

    {aiError && <p className="text-sm text-destructive">{aiError}</p>}

    <div className="flex justify-end gap-2 pt-1">
      <Button variant="outline" size="sm" onClick={() => void refreshAi()}>
        Durumu Yenile
      </Button>
    </div>
  </div>

  {/*
   * Açık rıza onayı. Etkinleştirme İNDİRME BAŞLATMAZ (yalnızca `enabled` yazılır);
   * vazgeçilirse hiçbir şey olmaz. Kapatma ise asistan + anlamsal aramanın
   * duracağını dürüstçe söyler — veri kaybı yok, modeller diskte kalır.
   */}
  <ConfirmDialog
    open={aiConfirm !== null}
    onOpenChange={(next) => {
      if (!next) setAiConfirm(null);
    }}
    title={aiConfirm === 'disable' ? 'Yerel AI kapatılsın mı?' : "Yerel AI'yı etkinleştir"}
    description={
      aiConfirm === 'disable' ? (
        'Asistan ve anlamsal arama çalışmayı durdurur. İndirilmiş modeller diskte kalır; dilediğinde yeniden açabilirsin.'
      ) : (
        <>
          Yalnızca özellik açılır; <span className="font-medium text-foreground">hiçbir indirme başlamaz</span>.
          Gerekli bileşenler için toplam indirme {aiTotalLabel}. İndirmeleri Ayarlar → Bileşenler bölümünden sen
          başlatırsın.
        </>
      )
    }
    confirmLabel={aiConfirm === 'disable' ? 'Kapat' : 'Etkinleştir'}
    cancelLabel="Vazgeç"
    tone="default"
    onConfirm={() => {
      const enabled = aiConfirm !== 'disable';
      setAiConfirm(null);
      void runSetAiEnabled(enabled);
    }}
  />
  </>
  );
}
