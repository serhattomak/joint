import { FolderOpen, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  FAMILY_LABEL,
  isAudioTarget,
  targetsFor,
  type ConversionOptions,
  type ConversionTarget,
  type SourceFamily,
} from '@/lib/conversion';

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
  const primary = families[0] ?? 'unknown';
  const targets: ConversionTarget[] =
    primary === 'unknown'
      ? []
      : targetsFor(primary).filter((candidate) =>
          families.every((family) =>
            targetsFor(family).some((item) => item.id === candidate.id),
          ),
        );
  const activeTarget = targets.find((item) => item.id === target);
  const audioTarget = isAudioTarget(target);
  const videoFamily = primary === 'video';
  const isPdfSource = primary === 'pdf';
  const isOffice =
    primary === 'document' || primary === 'spreadsheet' || primary === 'presentation';
  const imageTarget = target === 'png' || target === 'jpg';

  if (selectedCount === 0) {
    return (
      <section className="settings-card flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Sparkles className="size-7 text-muted-foreground" />
        <p className="text-title">Hedefi seç</p>
        <p className="max-w-[42ch] text-sm text-muted-foreground">
          Soldan bir kaynak seç; burada o kaynağın gerçekten dönüştürülebileceği biçimler
          listelenir. Aynı türden birden çok dosyayı birlikte seçebilirsin.
        </p>
      </section>
    );
  }

  if (targets.length === 0) {
    return (
      <section className="settings-card flex flex-col gap-3 p-4">
        <h3 className="text-sm font-medium">Hedef</h3>
        <p className="text-sm text-muted-foreground">
          Seçili kaynakların ortak bir hedefi yok. Aynı türden dosyaları birlikte seç ya da
          işlemleri ayrı ayrı yap.
        </p>
      </section>
    );
  }

  return (
    <section className="settings-card flex min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-3">
        <div>
          <h3 className="text-sm font-medium">Hedef</h3>
          <p className="text-micro text-muted-foreground">
            {families.length === 1
              ? `${FAMILY_LABEL[primary as Exclude<SourceFamily, 'unknown'>]} · ${selectedCount} kaynak`
              : `${selectedCount} kaynak · ortak hedefler`}
          </p>
        </div>
        {activeTarget?.hint && (
          <span className="text-micro text-muted-foreground">{activeTarget.hint}</span>
        )}
      </header>

      <div className="flex flex-col gap-4 p-3">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label="Hedef biçim">
          {targets.map((candidate) => {
            const active = candidate.id === target;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onTargetChange(candidate.id)}
                aria-pressed={active}
                disabled={running}
                title={candidate.hint ?? candidate.label}
                aria-label={`${candidate.label} (.${candidate.id})`}
                className={`flex min-h-9 items-center justify-center gap-2 rounded-sm border px-2.5 py-1.5 text-center text-sm transition-colors duration-150 ease-out ${
                  active
                    ? 'border-primary/45 bg-primary/10 font-medium text-foreground'
                    : 'border-input text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                } disabled:opacity-45`}
              >
                <span className="truncate">{candidate.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col divide-y divide-border/70 border-t border-border/70 pt-1">
          {(primary === 'audio' || primary === 'video') && (
            <>
              {!audioTarget && (
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
                        onOptionsChange({
                          resolution: value as ConversionOptions['resolution'],
                        })
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
              {target === 'gif' && (
                <div className="grid grid-cols-2 gap-2 py-2">
                  <Field label="GIF kare hızı" htmlFor="gif-fps">
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
                  <Field label="GIF genişliği (px)" htmlFor="gif-width">
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
              )}
              <SettingRow label="Ses bit hızı">
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
                    onOptionsChange({
                      sample_rate: value as ConversionOptions['sample_rate'],
                    })
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
              {videoFamily && !audioTarget && target !== 'gif' && (
                <SettingRow label="Sesi kaldır" hint="Video sessiz kalsın">
                  <Switch
                    checked={options.mute}
                    onCheckedChange={(checked) => onOptionsChange({ mute: checked })}
                    disabled={running}
                    aria-label="Sesi kaldır"
                  />
                </SettingRow>
              )}
            </>
          )}

          {(primary === 'audio' || primary === 'video') && (
            <div className="grid grid-cols-2 gap-2 py-2">
              <Field label="Kırpma başlangıcı" htmlFor="trim-start" hint="sn ya da 00:00:00">
                <Input
                  id="trim-start"
                  value={options.trim_start}
                  onChange={(event) => onOptionsChange({ trim_start: event.target.value })}
                  placeholder="0"
                  disabled={running}
                />
              </Field>
              <Field label="Kırpma bitişi" htmlFor="trim-end" hint="boşsa sonuna kadar">
                <Input
                  id="trim-end"
                  value={options.trim_end}
                  onChange={(event) => onOptionsChange({ trim_end: event.target.value })}
                  placeholder="—"
                  disabled={running}
                />
              </Field>
            </div>
          )}

          {primary === 'image' && (
            <>
              <div className="grid grid-cols-2 gap-2 py-2">
                <Field label="Azami genişlik (px)" htmlFor="max-width" hint="0 = sınırsız">
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
                <Field label="Azami yükseklik (px)" htmlFor="max-height" hint="0 = sınırsız">
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
                <div className="grid grid-cols-2 gap-2 py-2">
                  <Field label="JPEG kalitesi" htmlFor="image-quality">
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
                    options={[
                      { value: 'a4', label: 'A4' },
                      { value: 'letter', label: 'Letter' },
                      { value: 'auto', label: 'Görsele göre' },
                    ]}
                    label="Sayfa boyutu"
                    size="sm"
                    disabled={running}
                    className="w-36"
                  />
                </SettingRow>
              )}
            </>
          )}

          {isPdfSource && target !== 'pdf' && (
            <>
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
            </>
          )}

          {isOffice && target === 'pdf' && (
            <>
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
                    onOptionsChange({
                      pdf_quality: value as ConversionOptions['pdf_quality'],
                    })
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
                    onCheckedChange={(checked) =>
                      onOptionsChange({ single_page_sheets: checked })
                    }
                    disabled={running}
                    aria-label="Her sayfayı tek sayfaya sığdır"
                  />
                </SettingRow>
              )}
            </>
          )}

          {isOffice && target === 'csv' && (
            <SettingRow label="CSV ayırıcı">
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
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-sm border border-border/70 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro text-muted-foreground">Çıktı</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={onPickOutputDir}
                disabled={running}
              >
                <FolderOpen /> Klasör
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

      <footer className="mt-auto flex flex-col gap-2 border-t border-border/70 p-3">
        {running && (
          <div className="flex items-center gap-2">
            <Progress
              value={overallPercent}
              readout
              aria-label="Toplu dönüşüm ilerlemesi"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={onCancel}>
              İptal
            </Button>
          </div>
        )}
        <Button onClick={onRun} disabled={running || selectedCount === 0 || !target} className="w-full">
          {running
            ? `Dönüştürülüyor… %${Math.round(overallPercent)}`
            : `Dönüştür · ${selectedCount} kaynak`}
        </Button>
        <p className="text-2xs text-muted-foreground">
          Çıktı varsa üzerine yazılmaz; dosya adına sıra numarası eklenir.
        </p>
      </footer>
    </section>
  );
}
