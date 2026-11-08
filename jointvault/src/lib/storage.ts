import { invoke } from '@tauri-apps/api/core';

export interface StorageFile {
  path: string;
  size: number;
}

export function scanStorage(): Promise<StorageFile[]> {
  return invoke<StorageFile[]>('scan_storage');
}

/** Windows yol karşılaştırması: ayırıcı ve büyük/küçük harf farkını yut. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
