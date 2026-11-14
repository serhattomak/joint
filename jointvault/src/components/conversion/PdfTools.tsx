import { useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  ArrowDown,
  ArrowUp,
  Combine,
  ExternalLink,
  FileText,
  FolderOpen,
  Images,
  Minimize2,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldGroup, SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useNotice } from '@/components/ui/notice';
import { ChoiceTile } from '@/components/conversion/ChoiceTile';
import { ConversionRunBar } from '@/components/conversion/ConversionRunBar';
import { recordConversionJob } from '@/lib/db/client';
import { basenameOf } from '@/lib/convert-path';
import { pdfToolOutputPath } from '@/lib/conversion';
import { cancelConversion, runPdfTool, useConversionProgress } from '@/lib/conversion-run';
import { useOpenTarget } from '@/lib/open-target';

type PdfTool = 'merge' | 'split' | 'rotate' | 'compress' | 'images_to_pdf';

const TOOLS: {
  value: PdfTool;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: 'merge', label: 'Birleştir', hint: 'N PDF → tek PDF', icon: Combine },
  { value: 'split', label: 'Sayfa ayır', hint: 'Aralık · her sayfa', icon: Scissors },
  { value: 'rotate', label: 'Döndür', hint: '90 / 180 / 270°', icon: RotateCw },
  { value: 'compress', label: 'Sıkıştır', hint: 'Nesne akışları', icon: Minimize2 },
  { value: 'images_to_pdf', label: 'Görsel → PDF', hint: 'N görsel → PDF', icon: Images },
];

const TOOL_DESCRIPTION: Record<PdfTool, string> = {
  merge: 'İki veya daha fazla PDF’i tek dosyada birleştirir; sıra listedeki sıradır.',
  split: 'Seçilen sayfa aralığını yeni bir PDF’e alır; istersen her sayfayı ayrı dosyaya yazar.',
  rotate: 'Seçili sayfaları 90/180/270° döndürür; diğer sayfalar değişmez.',
  compress: 'Nesne akışlarını ve xref’i sıkıştırır; içerik zaten sıkışıksa dosya küçülmeyebilir.',
  images_to_pdf: 'Görselleri sırayla sayfalara yerleştirir; her görsel bir sayfadır.',
};

const ANGLE_OPTIONS: SelectOption[] = [
  { value: '90', label: '90°' },
  { value: '180', label: '180°' },
  { value: '270', label: '270°' },
];

const PAGE_SIZE_OPTIONS: SelectOption[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'auto', label: 'Görsele göre' },
];

interface PdfToolsProps {
  onDone: () => void;
}

export function PdfTools({ onDone }: PdfToolsProps) {
  const notice = useNotice();
  const { reveal, open } = useOpenTarget();
  const [tool, setTool] = useState<PdfTool>('merge');
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(() =>
    window.localStorage.getItem('jv-convert-outdir'),
  );
  const [pageRange, setPageRange] = useState('');
  const [splitEach, setSplitEach] = useState(false);
  const [angle, setAngle] = useState<'90' | '180' | '270'>('90');
  const [pageSize, setPageSize] = useState<'a4' | 'letter' | 'auto'>('a4');
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const jobRef = useRef<string | null>(null);

  useConversionProgress((event) => {
    if (event.jobId !== jobRef.current) return;
    setPercent(Math.round(event.percent));
    setPhase(event.phase);
  });

  const activeTool = TOOLS.find((item) => item.value === tool) ?? TOOLS[0];
  const minimum = tool === 'merge' ? 2 : 1;
  const canRun = inputs.length >= minimum;

  const changeTool = (next: PdfTool): void => {
    setTool(next);
    setInputs((previous) => {
      const allowed = previous.filter((path) =>
        next === 'images_to_pdf'
          ? /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(path)
          : /\.pdf$/i.test(path),
      );
      return next === 'merge' || next === 'images_to_pdf' ? allowed : allowed.slice(0, 1);
    });
    setResults([]);
    setError(null);
  };

  const output = inputs[0] ? pdfToolOutputPath(inputs[0], tool, outputDir) : '';

  const pickFiles = async (): Promise<void> => {
    try {
      const picked = await openDialog({
        multiple: tool === 'merge' || tool === 'images_to_pdf',
        filters: [
          tool === 'images_to_pdf'
            ? {
                name: 'Görseller',
                extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif'],
              }
            : { name: 'PDF', extensions: ['pdf'] },
        ],
      });
      if (!picked) return;
      const list: string[] = Array.isArray(picked) ? picked : [picked];
      setInputs((previous) => {
        if (tool === 'merge' || tool === 'images_to_pdf') {
          return [...previous, ...list.filter((path) => !previous.includes(path))];
        }
        return list.slice(0, 1);
      });
      setResults([]);
      setError(null);
    } catch {
      /* seçimden vazgeçme sessiz */
    }
  };

  const pickOutputDir = async (): Promise<void> => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      setOutputDir(picked);
      window.localStorage.setItem('jv-convert-outdir', picked);
    } catch {
      /* vazgeçme sessiz */
    }
  };

  const move = (index: number, direction: -1 | 1): void => {
    setInputs((previous) => {
      const next = [...previous];
      const target = index + direction;
      if (target < 0 || target >= next.length) return previous;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const run = async (): Promise<void> => {
    if (busy || inputs.length === 0) return;
    if (tool === 'merge' && inputs.length < 2) {
      setError('Birleştirmek için en az iki PDF seç.');
      return;
    }
    if (tool !== 'merge' && tool !== 'images_to_pdf' && inputs.length !== 1) {
      setError('Bu araç tek dosya ile çalışır.');
      return;
    }
    const jobId = crypto.randomUUID();
    jobRef.current = jobId;
    setBusy(true);
    setError(null);
    setPercent(0);
    setPhase('hazırlanıyor');
    setResults([]);
    const result = await runPdfTool({
      jobId,
      tool,
      inputs,
      outputPath: output,
      options: {
        page_range: pageRange,
        split_each: splitEach,
        angle: Number(angle),
        page_size: pageSize,
      },
    });
    jobRef.current = null;
    setBusy(false);
    if (!result.ok) {
      if (!result.cancelled) setError(result.error ?? 'PDF işlemi başarısız.');
      return;
    }
    setPercent(100);
    setResults(result.outputs);
    for (const warning of result.warnings) {
      notice.push({ text: warning, tone: 'info' });
    }
    try {
      await recordConversionJob({
        id: result.jobId,
        inputPath: inputs[0] ?? '',
        outputPaths: result.outputs,
        target: 'pdf',
        sourceKind: tool === 'images_to_pdf' ? 'image' : 'pdf',
        status: 'done',
      });
    } catch {
      notice.push({ text: 'Dönüşüm geçmişi yazılamadı.', tone: 'info' });
    }
    onDone();
  };

  const cancel = (): void => {
    if (jobRef.current) void cancelConversion(jobRef.current);
  };

  return (
    <section className="settings-card flex flex-col">
      <header className="flex flex-col gap-1 border-b border-border/70 p-3">
        <h3 className="text-sm font-medium">PDF araçları</h3>
        <p className="max-w-[70ch] text-micro text-muted-foreground">
          {TOOL_DESCRIPTION[tool]}
        </p>
      </header>

      <div className="border-b border-border/70 p-3">
        <div
          role="group"
          aria-label="PDF aracı"
          className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr))]"
        >
          {TOOLS.map((item) => (
            <ChoiceTile
              key={item.value}
              active={item.value === tool}
              label={item.label}
              hint={item.hint}
              icon={item.icon}
              disabled={busy}
              onClick={() => changeTool(item.value)}
              ariaLabel={`${item.label} — ${item.hint}`}
            />
          ))}
        </div>
      </div>

      <div className="pdf-bench">
        <div className="pdf-bench-grid grid gap-4 p-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-micro font-medium text-muted-foreground">
              Dosyalar
              <span data-num className="ml-1.5 font-mono">
                {inputs.length}
              </span>
            </h4>
            <Button variant="outline" size="sm" onClick={() => void pickFiles()} disabled={busy}>
              <Plus /> {tool === 'images_to_pdf' ? 'Görsel ekle' : 'PDF ekle'}
            </Button>
          </div>

          {inputs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              {tool === 'images_to_pdf' ? (
                <Images className="size-6 text-muted-foreground" />
              ) : (
                <FileText className="size-6 text-muted-foreground" />
              )}
              <p className="max-w-[38ch] text-sm text-muted-foreground">
                {tool === 'merge'
                  ? 'Birleştirmek için en az iki PDF seç; sıra listedeki sıradır.'
                  : tool === 'images_to_pdf'
                    ? 'PDF’e dönüştürmek için görsel seç; her görsel bir sayfa olur.'
                    : 'İşlemek için bir PDF seç.'}
              </p>
            </div>
          ) : (
            <ul
              className="flex max-h-80 flex-col divide-y divide-border/70 overflow-y-auto"
              aria-label="Seçili dosyalar"
            >
              {inputs.map((path, index) => (
                <li key={path} className="flex items-center gap-2 py-1.5">
                  <span
                    data-num
                    className="flex size-6 shrink-0 items-center justify-center rounded-xs border border-border/70 font-mono text-2xs text-muted-foreground"
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{basenameOf(path)}</span>
                    <span className="truncate font-mono text-2xs text-muted-foreground">
                      {path}
                    </span>
                  </span>
                  {(tool === 'merge' || tool === 'images_to_pdf') && (
                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`${basenameOf(path)} yukarı taşı`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => move(index, 1)}
                        disabled={busy || index === inputs.length - 1}
                        aria-label={`${basenameOf(path)} aşağı taşı`}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      setInputs((previous) => previous.filter((item) => item !== path))
                    }
                    disabled={busy}
                    aria-label={`${basenameOf(path)} kaldır`}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <FieldGroup title="Ayarlar">
            {tool !== 'images_to_pdf' && (
              <SettingRow label="Sayfa aralığı" hint="boş = tümü">
                <Input
                  value={pageRange}
                  onChange={(event) => setPageRange(event.target.value)}
                  placeholder="1-3, 5"
                  aria-label="Sayfa aralığı"
                  disabled={busy}
                  className="w-32"
                />
              </SettingRow>
            )}
            {tool === 'split' && (
              <SettingRow label="Her sayfa ayrı dosya" hint="aralıktaki her sayfa">
                <Switch
                  checked={splitEach}
                  onCheckedChange={setSplitEach}
                  disabled={busy}
                  aria-label="Her sayfa ayrı dosya"
                />
              </SettingRow>
            )}
            {tool === 'rotate' && (
              <SettingRow label="Açı">
                <Select
                  value={angle}
                  onValueChange={(value) => setAngle(value as '90' | '180' | '270')}
                  options={ANGLE_OPTIONS}
                  label="Döndürme açısı"
                  size="sm"
                  disabled={busy}
                  className="w-28"
                />
              </SettingRow>
            )}
            {tool === 'images_to_pdf' && (
              <SettingRow label="Sayfa boyutu">
                <Select
                  value={pageSize}
                  onValueChange={(value) => setPageSize(value as 'a4' | 'letter' | 'auto')}
                  options={PAGE_SIZE_OPTIONS}
                  label="Sayfa boyutu"
                  size="sm"
                  disabled={busy}
                  className="w-36"
                />
              </SettingRow>
            )}
          </FieldGroup>

          <div className="flex flex-col gap-1 border-t border-border/70 pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-micro text-muted-foreground">Çıktı</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void pickOutputDir()}
                  disabled={busy}
                >
                  <FolderOpen /> Klasör seç
                </Button>
                {outputDir && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setOutputDir(null);
                      window.localStorage.removeItem('jv-convert-outdir');
                    }}
                    disabled={busy}
                  >
                    <RotateCcw /> Sıfırla
                  </Button>
                )}
              </div>
            </div>
            <p className="truncate font-mono text-2xs text-muted-foreground" title={output}>
              {output || 'Bir dosya seç'}
            </p>
          </div>
        </div>
      </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-3 mb-3 rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border/70 p-3">
          <h4 className="text-micro font-medium text-muted-foreground">
            Üretilenler
            <span data-num className="ml-1.5 font-mono">
              {results.length}
            </span>
          </h4>
          <ul className="flex flex-col divide-y divide-border/70">
            {results.map((path) => (
              <li key={path} className="flex items-center gap-1.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
                  {basenameOf(path)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => reveal(path)}
                  aria-label={`${basenameOf(path)} dosyasını klasörde göster`}
                  title="Klasörde göster"
                >
                  <FolderOpen />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => open(path)}
                  aria-label={`${basenameOf(path)} çıktısını aç`}
                  title="Çıktıyı aç"
                >
                  <ExternalLink />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConversionRunBar
        summary={
          busy
            ? `${activeTool.label} · ${phase || 'çalışıyor'}`
            : `${inputs.length} dosya · ${activeTool.label}`
        }
        hint={
          tool === 'merge'
            ? 'En az 2 PDF · üzerine yazılmaz'
            : tool === 'images_to_pdf'
              ? 'En az 1 görsel · üzerine yazılmaz'
              : '1 PDF · üzerine yazılmaz'
        }
        actionLabel="Çalıştır"
        disabled={busy || !canRun}
        running={busy}
        percent={percent}
        onRun={() => void run()}
        onCancel={cancel}
      />
    </section>
  );
}
