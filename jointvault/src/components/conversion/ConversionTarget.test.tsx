import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultOptions } from '@/lib/conversion';
import { ConversionTarget } from './ConversionTarget';

const noop = (): void => undefined;

const props = {
  families: ['video' as const],
  target: 'mp4',
  selectedCount: 3,
  options: defaultOptions(),
  outputPreview: 'C:\\Arşiv\\Dönüşüm\\roportaj-mp4.mp4',
  outputDir: null,
  running: false,
  overallPercent: 0,
  onTargetChange: noop,
  onOptionsChange: noop,
  onPickOutputDir: noop,
  onClearOutputDir: noop,
  onRun: noop,
  onCancel: noop,
};

describe('ConversionTarget', () => {
  it('ayarları kapalı panelde özetler, seçenekleri çizmez', () => {
    const html = renderToStaticMarkup(<ConversionTarget {...props} />);

    expect(html).toContain('Ayarlar');
    expect(html).toContain('Dengeli');
    expect(html).toContain('192 kbps');
    expect(html).toContain('Düzenle');
    // Panel kapalıyken ayar satırları DOM'a girmez.
    expect(html).not.toContain('Kalite');
  });

  it('GIF hedefinde yalnız gerçekten etkili ölçüleri özetler', () => {
    const html = renderToStaticMarkup(
      <ConversionTarget {...props} target="gif" />,
    );

    expect(html).toContain('12 fps');
    expect(html).toContain('480 px');
    // GIF'te ses ve çözünürlük seçenekleri yoktur.
    expect(html).not.toContain('Bit hızı');
    expect(html).not.toContain('Çözünürlük');
  });
});
