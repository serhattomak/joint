import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DownloadJob } from '@/lib/db/client';
import { TransferRow, type TransferRowActions } from './TransferRow';
import type { TurboTransfer } from './model';

const job: DownloadJob = {
  id: 'job-1',
  url: 'https://example.com/a.zip',
  filename: 'a.zip',
  destination_path: 'C:/İndirilenler/a.zip',
  file_size: 2048,
  downloaded_size: 2048,
  status: 'completed',
  category: 'archive',
  threads: 8,
  speed_bps: 0,
  eta_secs: 0,
  error_message: null,
  created_at: '2026-01-01T10:00:00.000Z',
  updated_at: '2026-01-01T10:00:00.000Z',
};

const row: TurboTransfer = {
  kind: 'turbo',
  job,
  key: 't:job-1',
  id: job.id,
  title: 'Örnek arşiv dosyası',
  source: job.url,
  engine: 'Turbo',
  detail: '8 kanal',
  status: 'done',
  progress: 100,
  size: job.file_size,
  downloaded: job.downloaded_size,
  speed: 0,
  eta: 0,
  speedText: null,
  etaText: null,
  path: job.destination_path,
  convertedPath: null,
  createdAt: job.created_at,
  platform: 'other',
  category: 'archive',
  error: null,
};

const noop = (): void => undefined;
const actions: TransferRowActions = {
  toggleSelected: noop,
  toggleExpanded: noop,
  pause: noop,
  resume: noop,
  retryVault: noop,
  copyText: noop,
  open: noop,
  reveal: noop,
  requestDelete: noop,
  installComponent: noop,
};

describe('TransferRow', () => {
  it('tamamlanan işi ad, boyut ve durumla render eder', () => {
    const html = renderToStaticMarkup(
      <TransferRow
        row={row}
        selected={false}
        expanded={false}
        downloadDir="C:/İndirilenler"
        chunks={[]}
        actions={actions}
      />,
    );
    expect(html).toContain('Örnek arşiv dosyası');
    expect(html).toContain('2 KB');
    expect(html).toContain('Aç');
  });

  it('aktif işte yüzde ve duraklat eylemini gösterir', () => {
    const html = renderToStaticMarkup(
      <TransferRow
        row={{ ...row, status: 'active', progress: 42 }}
        selected={false}
        expanded={false}
        downloadDir={null}
        chunks={[{ id: 0, percent: 42 }]}
        actions={actions}
      />,
    );
    expect(html).toContain('%42');
    expect(html).toContain('Duraklat');
  });
});
