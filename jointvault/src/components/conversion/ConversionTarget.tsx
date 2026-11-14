import { useState } from 'react';
import { ChevronDown, FolderOpen, RotateCcw, Sparkles, Split } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ChoiceTile } from '@/components/conversion/ChoiceTile';
import { ConversionRunBar } from '@/components/conversion/ConversionRunBar';
import {
  FAMILY_LABEL,
  isAudioTarget,
  targetsFor,
  type ConversionOptions,
  type ConversionTarget,
  type SourceFamily,
} from '@/lib/conversion';
import { cn } from 'cn';

const QUALITY_OPTIONS: SelectOption[] = [
  { value: 'compact', label: 'Küçük dosya', hint: 'Daha düşük bit hızı' },
  { value: 'balanced', label: 'Dengeli', hint: 'Varsayılan' },
  { value: 'high', label: 'Yüksek kalite', hint: 'Daha büyük dosya' },
];

const RESOLUTION_OPTIONS: SelectOption[] = [
  { value: 'original', label: 'Özgün çözünürlük' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];

const FPS_OPTIONS: SelectOption[] = [
  { value: 'original', label: 'Özgün' },
  { value: '60', label: '60 fps' },
  { value: '50', label: '50 fps' },
  { value: '30', label: '30 fps' },
  { value: '25', label: '25 fps' },
  { value: '24', label: '24 fps' },
  { value: '15', label: '15 fps' },
];

const AUDIO_BITRATE_OPTIONS: SelectOption[] = [
  { value: '96', label: '96 kbps' },
  { value: '128', label: '128 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '256', label: '256 kbps' },
  { value: '320', label: '320 kbps' },
];

const SAMPLE_RATE_OPTIONS: SelectOption[] = [
  { value: 'original', label: 'Özgün' },
  { value: '48000', label: '48 kHz' },
  { value: '44100', label: '44.1 kHz' },
  { value: '22050', label: '22.05 kHz' },
];

const CHANNEL_OPTIONS: SelectOption[] = [
  { value: 'original', label: 'Özgün' },
  { value: 'mono', label: 'Mono' },
  { value: 'stereo', label: 'Stereo' },
];

const PDF_QUALITY_OPTIONS: SelectOption[] = [
  { value: 'screen', label: 'Ekran', hint: 'En küçük dosya' },
  { value: 'ebook', label: 'E-kitap', hint: 'Dengeli' },
  { value: 'print', label: 'Baskı', hint: 'En yüksek kalite' },
];

const DPI_OPTIONS: SelectOption[] = [
  { value: '72', label: '72 DPI', hint: 'Hızlı taslak' },
  { value: '150', label: '150 DPI', hint: 'Dengeli' },
  { value: '300', label: '300 DPI', hint: 'Baskı kalitesi' },
];

const DELIMITER_OPTIONS: SelectOption[] = [
  { value: ',', label: 'Virgül (,)' },
  { value: ';', label: 'Noktalı virgül (;)' },
  { value: '\t', label: 'Sekme' },
];

const PAGE_SIZE_OPTIONS: SelectOption[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'auto', label: 'Görsele göre' },
];

function optionLabel(options: SelectOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Uzantıyı tekrar eden ipucu gösterilmez (Word · DOCX gibi). */
function hintFor(candidate: ConversionTarget): string | undefined {
  const hint = candidate.hint?.trim();
  if (!hint) return undefined;
  if (hint.toLowerCase() === candidate.id.toLowerCase()) return undefined;
  return hint;
}

interface ConversionTargetProps {
  families: SourceFamily[];
  target: string;
  selectedCount: number;
  options: ConversionOptions;
  outputPreview: string;
  outputDir: string | null;
  running: boolean;
  overallPercent: number;
  onTargetChange: (target: string) => void;
  onOptionsChange: (patch: Partial<ConversionOptions>) => void;
  onPickOutputDir: () => void;
  onClearOutputDir: () => void;
  onRun: () => void;
  onCancel: () => void;
}

export function ConversionTarget({
  families,
  target,
  selectedCount,
  options,
  outputPreview,
  outputDir,
  running,
  overallPercent,
  onTargetChange,
  onOptionsChange,
  onPickOutputDir,
  onClearOutputDir,
  onRun,
  onCancel,
}: ConversionTargetProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const primary = families[0] ?? 'unknown';
  const targets: ConversionTarget[] =
    primary === 'unknown'
      ? []
      : targetsFor(primary).filter((candidate) =>
          families.every((family) => targetsFor(family).some((item) => item.id === candidate.id)),
        );
  const audioTarget = isAudioTarget(target);
  const videoFamily = primary === 'video';
  const isGif = target === 'gif';
  const isPdfSource = primary === 'pdf';
  const isOffice =
    primary === 'document' || primary === 'spreadsheet' || primary === 'presentation';
  const imageTarget = target === 'png' || target === 'jpg';
  const audioOrVideo = primary === 'audio' || primary === 'video';
  const hasSettings =
    audioOrVideo ||
    primary === 'image' ||
    (isPdfSource && target !== 'pdf') ||
    (isOffice && (target === 'pdf' || target === 'csv'));

  // Kapalı panelde de yürürlükteki ölçüler okunur: hangi kalite, hangi aralık.
  const settingsSummary = (() => {
    const parts: string[] = [];
    if (audioOrVideo) {
      if (audioTarget) {
        parts.push(`${options.audio_bitrate} kbps`);
        if (options.sample_rate !== 'original') {
          parts.push(optionLabel(SAMPLE_RATE_OPTIONS, options.sample_rate));
        }
        if (options.channels !== 'original') {
          parts.push(optionLabel(CHANNEL_OPTIONS, options.channels));
        }
      } else if (isGif) {
        parts.push(`${options.gif_fps} fps`, `${options.gif_width} px`);
      } else {
        parts.push(
          optionLabel(QUALITY_OPTIONS, options.quality),
          optionLabel(RESOLUTION_OPTIONS, options.resolution),
          `${options.audio_bitrate} kbps`,
        );
        if (options.mute) parts.push('ses kapalı');
      }
      if (options.trim_start || options.trim_end) {
        parts.push(`kırpma ${options.trim_start || '0'}–${options.trim_end || 'son'}`);
      }
    }
    if (primary === 'image') {
      parts.push(
        options.max_width > 0 || options.max_height > 0
          ? `${options.max_width > 0 ? options.max_width : '∞'} × ${
              options.max_height > 0 ? options.max_height : '∞'
            } px`
          : 'özgün boyut',
      );
      if (target === 'jpg') parts.push(`JPEG ${options.image_quality}`);
      if (target === 'pdf') parts.push(optionLabel(PAGE_SIZE_OPTIONS, options.page_size));
    }
    if (isPdfSource && target !== 'pdf') {
      parts.push(options.page_range.trim() ? `sayfa ${options.page_range}` : 'tüm sayfalar');
      if (imageTarget) parts.push(`${options.dpi} DPI`, `JPEG ${options.image_quality}`);
    }
    if (isOffice && target === 'pdf') {
      parts.push(
        options.page_range.trim() ? `sayfa ${options.page_range}` : 'tüm sayfalar',
        optionLabel(PDF_QUALITY_OPTIONS, options.pdf_quality),
        options.pdfa ? 'PDF/A' : 'PDF/A kapalı',
      );
      if (primary === 'spreadsheet' && options.single_page_sheets) parts.push('tek sayfa');
    }
    if (isOffice && target === 'csv') {
      parts.push(optionLabel(DELIMITER_OPTIONS, options.csv_delimiter));
    }
    return parts.join(' · ');
  })();

  if (selectedCount === 0) {
    return (
      <section className="settings-card flex flex-col items-center justify-center gap-3 p-8 text-center">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <Sparkles className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-title">Hedefi seç</p>
          <p className="mx-auto max-w-[42ch] text-sm text-muted-foreground">
            Bir kaynak seç; burada yalnızca gerçekten dönüştürülebileceği biçimler listelenir.
            Aynı türden birden çok dosyayı birlikte seçebilirsin.
          </p>
        </div>
        <p className="text-2xs text-muted-foreground">Belge · PDF · Görsel · Ses · Video</p>
      </section>
    );
  }

  if (targets.length === 0) {
    return (
      <section className="settings-card flex flex-col items-center justify-center gap-3 p-8 text-center">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"
        >
          <Split className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-title">Ortak hedef yok</p>
          <p className="mx-auto max-w-[42ch] text-sm text-muted-foreground">
            Seçili kaynakların kesişen bir biçimi yok. Aynı türden dosyaları birlikte seç ya da
            işlemleri ayrı ayrı yap.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {families.map((family) => (
            <Badge key={family} variant="secondary">
              {family === 'unknown' ? 'Bilinmeyen' : FAMILY_LABEL[family]}
            </Badge>
          ))}
        </div>
      </section>
    );
  }

  const summary = (
    <>
      <span data-num>{selectedCount}</span> kaynak
      <span className="text-muted-foreground"> → </span>
      <span data-num className="font-mono">
        .{target}
      </span>
    </>
  );

  return (
    <section className="settings-card flex min-h-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 p-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Hedef biçim</h3>
          <p className="text-micro text-muted-foreground">
            {families.length === 1
              ? `${FAMILY_LABEL[primary as Exclude<SourceFamily, 'unknown'>]} · ${selectedCount} kaynak`
              : `${selectedCount} kaynak · ortak biçimler`}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {targets.length} biçim
        </Badge>
      </header>

      <div className="flex flex-col gap-3 p-3">
        <div
          role="group"
          aria-label="Hedef biçim"
          className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr))]"
        >
          {targets.map((candidate) => {
            const hint = hintFor(candidate);
            const sameAsLabel =
              candidate.label.toLowerCase() === candidate.id.toLowerCase();
            return (
              <ChoiceTile
                key={candidate.id}
                active={candidate.id === target}
                label={candidate.label}
                ext={sameAsLabel ? undefined : candidate.id}
                hint={hint}
                disabled={running}
                onClick={() => onTargetChange(candidate.id)}
                ariaLabel={`${candidate.label} (.${candidate.id})${hint ? ` — ${hint}` : ''}`}
              />
            );
          })}
        </div>

        {hasSettings && (
          <div className="border-t border-border/70">
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-expanded={settingsOpen}
              aria-label={settingsOpen ? 'Ayarları kapat' : 'Ayarları düzenle'}
              aria-describedby="conversion-settings-summary"
              className="flex w-full items-center justify-between gap-3 rounded-sm px-1.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/30"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-micro font-medium">Ayarlar</span>
                <span
                  id="conversion-settings-summary"
                  className="truncate text-2xs text-muted-foreground"
                  title={settingsSummary}
                >
                  {settingsSummary}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-micro text-muted-foreground">
                {settingsOpen ? 'Kapat' : 'Düzenle'}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'size-3.5 transition-transform duration-150 ease-out',
                    settingsOpen && 'rotate-180',
                  )}
                />
              </span>
            </button>

            {settingsOpen && (
              <div className="flex flex-col gap-3 pt-1 pb-2">
                {audioOrVideo && !audioTarget && (
          <FieldGroup title={isGif ? 'GIF' : 'Görüntü'}>
            {isGif ? (
              <div className="grid grid-cols-2 gap-2 py-2">
                <Field label="Kare hızı" htmlFor="gif-fps" hint="5–30">
                  <Input
                    id="gif-fps"
                    type="number"
                    min={5}
                    max={30}
                    value={options.gif_fps}
                    onChange={(event) =>
                      onOptionsChange({ gif_fps: Number(event.target.value) || 12 })
                    }
                    disabled={running}
                  />
                </Field>
                <Field label="Genişlik (px)" htmlFor="gif-width" hint="160–960">
                  <Input
                    id="gif-width"
                    type="number"
                    min={160}
                    max={960}
                    step={80}
                    value={options.gif_width}
                    onChange={(event) =>
                      onOptionsChange({ gif_width: Number(event.target.value) || 480 })
                    }
                    disabled={running}
                  />
                </Field>
              </div>
            ) : (
              <>
                <SettingRow label="Kalite">
                  <Select
                    value={options.quality}
                    onValueChange={(value) =>
                      onOptionsChange({ quality: value as ConversionOptions['quality'] })
                    }
                    options={QUALITY_OPTIONS}
                    label="Kalite"
                    size="sm"
                    disabled={running}
                    className="w-40"
                  />
                </SettingRow>
                <SettingRow label="Çözünürlük">
                  <Select
                    value={options.resolution}
                    onValueChange={(value) =>
                      onOptionsChange({ resolution: value as ConversionOptions['resolution'] })
                    }
                    options={RESOLUTION_OPTIONS}
                    label="Çözünürlük"
                    size="sm"
                    disabled={running}
                    className="w-40"
                  />
                </SettingRow>
                <SettingRow label="Kare hızı">
                  <Select
                    value={options.fps}
                    onValueChange={(value) =>
                      onOptionsChange({ fps: value as ConversionOptions['fps'] })
                    }
                    options={FPS_OPTIONS}
                    label="Kare hızı"
                    size="sm"
                    disabled={running}
                    className="w-32"
                  />
                </SettingRow>
              </>
            )}
          </FieldGroup>
        )}

        {audioOrVideo && !isGif && (
          <FieldGroup title="Ses">
            <SettingRow label="Bit hızı">
              <Select
                value={options.audio_bitrate}
                onValueChange={(value) => onOptionsChange({ audio_bitrate: value })}
                options={AUDIO_BITRATE_OPTIONS}
                label="Ses bit hızı"
                size="sm"
                disabled={running}
                className="w-32"
              />
            </SettingRow>
            <SettingRow label="Örnekleme">
              <Select
                value={options.sample_rate}
                onValueChange={(value) =>
                  onOptionsChange({ sample_rate: value as ConversionOptions['sample_rate'] })
                }
                options={SAMPLE_RATE_OPTIONS}
                label="Örnekleme hızı"
                size="sm"
                disabled={running}
                className="w-32"
              />
            </SettingRow>
            <SettingRow label="Kanallar">
              <Select
                value={options.channels}
                onValueChange={(value) =>
                  onOptionsChange({ channels: value as ConversionOptions['channels'] })
                }
                options={CHANNEL_OPTIONS}
                label="Kanallar"
                size="sm"
                disabled={running}
                className="w-32"
              />
            </SettingRow>
            {videoFamily && !audioTarget && (
              <SettingRow label="Sesi kaldır" hint="Video sessiz kalsın">
                <Switch
                  checked={options.mute}
                  onCheckedChange={(checked) => onOptionsChange({ mute: checked })}
                  disabled={running}
                  aria-label="Sesi kaldır"
                />
              </SettingRow>
            )}
          </FieldGroup>
        )}

        {audioOrVideo && (
          <FieldGroup title="Kırpma">
            <div className="grid grid-cols-2 gap-2 py-2">
              <Field label="Başlangıç" htmlFor="trim-start" hint="sn ya da 00:00:00">
                <Input
                  id="trim-start"
                  value={options.trim_start}
                  onChange={(event) => onOptionsChange({ trim_start: event.target.value })}
                  placeholder="0"
                  disabled={running}
                />
              </Field>
              <Field label="Bitiş" htmlFor="trim-end" hint="boşsa sonuna kadar">
                <Input
                  id="trim-end"
                  value={options.trim_end}
                  onChange={(event) => onOptionsChange({ trim_end: event.target.value })}
                  placeholder="—"
                  disabled={running}
                />
              </Field>
            </div>
          </FieldGroup>
        )}

        {primary === 'image' && (
          <FieldGroup title="Görüntü">
            <div className="grid grid-cols-2 gap-2 py-2">
              <Field label="Azami genişlik" htmlFor="max-width" hint="0 = sınırsız">
                <Input
                  id="max-width"
                  type="number"
                  min={0}
                  max={12000}
                  value={options.max_width}
                  onChange={(event) =>
                    onOptionsChange({ max_width: Number(event.target.value) || 0 })
                  }
                  disabled={running}
                />
              </Field>
              <Field label="Azami yükseklik" htmlFor="max-height" hint="0 = sınırsız">
                <Input
                  id="max-height"
                  type="number"
                  min={0}
                  max={12000}
                  value={options.max_height}
                  onChange={(event) =>
                    onOptionsChange({ max_height: Number(event.target.value) || 0 })
                  }
                  disabled={running}
                />
              </Field>
            </div>
            {target === 'jpg' && (
              <div className="grid grid-cols-2 gap-2 pb-2">
                <Field label="JPEG kalitesi" htmlFor="image-quality" hint="40–100">
                  <Input
                    id="image-quality"
                    type="number"
                    min={40}
                    max={100}
                    value={options.image_quality}
                    onChange={(event) =>
                      onOptionsChange({ image_quality: Number(event.target.value) || 90 })
                    }
                    disabled={running}
                  />
                </Field>
                <Field label="Arka plan" htmlFor="image-background" hint="saydamlık için">
                  <Input
                    id="image-background"
                    value={options.background}
                    onChange={(event) => onOptionsChange({ background: event.target.value })}
                    placeholder="#ffffff"
                    disabled={running}
                  />
                </Field>
              </div>
            )}
            {target === 'pdf' && (
              <SettingRow label="Sayfa boyutu">
                <Select
                  value={options.page_size}
                  onValueChange={(value) =>
                    onOptionsChange({ page_size: value as ConversionOptions['page_size'] })
                  }
                  options={PAGE_SIZE_OPTIONS}
                  label="Sayfa boyutu"
                  size="sm"
                  disabled={running}
                  className="w-36"
                />
              </SettingRow>
            )}
          </FieldGroup>
        )}

        {isPdfSource && target !== 'pdf' && (
          <FieldGroup title="Sayfalar">
            <SettingRow label="Sayfa aralığı" hint="boş = tümü">
              <Input
                value={options.page_range}
                onChange={(event) => onOptionsChange({ page_range: event.target.value })}
                placeholder="1-3, 5"
                aria-label="Sayfa aralığı"
                disabled={running}
                className="w-36"
              />
            </SettingRow>
            {imageTarget && (
              <>
                <SettingRow label="Görüntü çözünürlüğü">
                  <Select
                    value={String(options.dpi)}
                    onValueChange={(value) => onOptionsChange({ dpi: Number(value) })}
                    options={DPI_OPTIONS}
                    label="Görüntü çözünürlüğü"
                    size="sm"
                    disabled={running}
                    className="w-36"
                  />
                </SettingRow>
                <SettingRow label="JPEG kalitesi">
                  <Input
                    type="number"
                    min={40}
                    max={100}
                    value={options.image_quality}
                    onChange={(event) =>
                      onOptionsChange({ image_quality: Number(event.target.value) || 88 })
                    }
                    aria-label="JPEG kalitesi"
                    disabled={running}
                    className="w-20"
                  />
                </SettingRow>
              </>
            )}
          </FieldGroup>
        )}

        {isOffice && target === 'pdf' && (
          <FieldGroup title="PDF">
            <SettingRow label="Sayfa aralığı" hint="boş = tümü">
              <Input
                value={options.page_range}
                onChange={(event) => onOptionsChange({ page_range: event.target.value })}
                placeholder="1-3, 5"
                aria-label="Sayfa aralığı"
                disabled={running}
                className="w-36"
              />
            </SettingRow>
            <SettingRow label="PDF kalitesi">
              <Select
                value={options.pdf_quality}
                onValueChange={(value) =>
                  onOptionsChange({ pdf_quality: value as ConversionOptions['pdf_quality'] })
                }
                options={PDF_QUALITY_OPTIONS}
                label="PDF kalitesi"
                size="sm"
                disabled={running}
                className="w-36"
              />
            </SettingRow>
            <SettingRow label="PDF/A arşiv biçimi" hint="uzun süreli saklama">
              <Switch
                checked={options.pdfa}
                onCheckedChange={(checked) => onOptionsChange({ pdfa: checked })}
                disabled={running}
                aria-label="PDF/A arşiv biçimi"
              />
            </SettingRow>
            {primary === 'spreadsheet' && (
              <SettingRow label="Her sayfayı tek sayfaya sığdır" hint="geniş tablolar için">
                <Switch
                  checked={options.single_page_sheets}
                  onCheckedChange={(checked) => onOptionsChange({ single_page_sheets: checked })}
                  disabled={running}
                  aria-label="Her sayfayı tek sayfaya sığdır"
                />
              </SettingRow>
            )}
          </FieldGroup>
        )}

        {isOffice && target === 'csv' && (
          <FieldGroup title="CSV">
            <SettingRow label="Ayırıcı">
              <Select
                value={options.csv_delimiter}
                onValueChange={(value) =>
                  onOptionsChange({ csv_delimiter: value as ConversionOptions['csv_delimiter'] })
                }
                options={DELIMITER_OPTIONS}
                label="CSV ayırıcı"
                size="sm"
                disabled={running}
                className="w-40"
              />
            </SettingRow>
          </FieldGroup>
        )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1 border-t border-border/70 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro text-muted-foreground">Çıktı</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={onPickOutputDir} disabled={running}>
                <FolderOpen /> Klasör seç
              </Button>
              {outputDir && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={onClearOutputDir}
                  disabled={running}
                  aria-label="Çıktı klasörünü sıfırla"
                >
                  <RotateCcw /> Sıfırla
                </Button>
              )}
            </div>
          </div>
          <p className="truncate font-mono text-2xs text-muted-foreground" title={outputPreview}>
            {outputPreview || 'Bir kaynak seç'}
          </p>
        </div>
      </div>

      <ConversionRunBar
        summary={summary}
        hint="Çıktı varsa üzerine yazılmaz · Ctrl+Enter"
        actionLabel="Dönüştür"
        disabled={running || selectedCount === 0}
        running={running}
        percent={overallPercent}
        onRun={onRun}
        onCancel={onCancel}
      />
    </section>
  );
}
