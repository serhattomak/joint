import { describe, expect, it } from 'vitest';
import { CATEGORY_FOLDER, destinationPath, sortDownloadJobs } from './downloads';

describe('destinationPath (kategori klasörleri)', () => {
  it('açıkken dosyayı türüne göre alt klasöre koyar', () => {
    expect(destinationPath('C:\\dl\\', 'arsiv.zip', 'archive', true)).toBe(
      'C:\\dl/Sıkıştırılmış/arsiv.zip',
    );
    expect(destinationPath('C:\\dl', 'klip.mp4', 'video', true)).toBe('C:\\dl/Video/klip.mp4');
  });

  it('kapalıyken doğrudan indirme köküne koyar', () => {
    expect(destinationPath('C:\\dl\\', 'arsiv.zip', 'archive', false)).toBe('C:\\dl/arsiv.zip');
  });

  it('her kategori için bir klasör adı tanımlıdır', () => {
    const categories = ['video', 'audio', 'archive', 'document', 'program', 'other'] as const;
    for (const c of categories) {
      expect(CATEGORY_FOLDER[c]).toBeTruthy();
    }
  });
});

describe('sortDownloadJobs', () => {
  const job = (
    filename: string,
    file_size: number,
    status: 'active' | 'completed' | 'error',
    created_at: string,
  ) => ({ filename, file_size, status, created_at });

  const jobs = [
    job('b.zip', 300, 'completed', '2026-01-02T00:00:00Z'),
    job('a.mp4', 900, 'error', '2026-01-03T00:00:00Z'),
    job('c.mp3', 100, 'active', '2026-01-01T00:00:00Z'),
  ];

  it('ada, boyuta ve duruma göre sıralar', () => {
    expect(sortDownloadJobs(jobs, 'name').map((j) => j.filename)).toEqual([
      'a.mp4',
      'b.zip',
      'c.mp3',
    ]);
    expect(sortDownloadJobs(jobs, 'size').map((j) => j.filename)).toEqual([
      'a.mp4',
      'b.zip',
      'c.mp3',
    ]);
    expect(sortDownloadJobs(jobs, 'status').map((j) => j.filename)).toEqual([
      'c.mp3',
      'a.mp4',
      'b.zip',
    ]);
  });

  it('en yeni/en eski tarihe göre sıralar ve girdiyi değiştirmez', () => {
    expect(sortDownloadJobs(jobs, 'oldest').map((j) => j.filename)).toEqual([
      'c.mp3',
      'b.zip',
      'a.mp4',
    ]);
    expect(sortDownloadJobs(jobs, 'newest').map((j) => j.filename)).toEqual([
      'b.zip',
      'a.mp4',
      'c.mp3',
    ]);
    expect(jobs.map((j) => j.filename)).toEqual(['b.zip', 'a.mp4', 'c.mp3']);
  });
});
