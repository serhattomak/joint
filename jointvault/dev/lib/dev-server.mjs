/*
 * Vite dev sunucusunu kanıt turu için ayağa kaldırır — üretim kodu DEĞİL.
 *
 * Kural: betik yalnızca KENDİ başlattığı sunucuyu kapatır. Port zaten doluysa
 * (kullanıcı `npm run dev` çalıştırıyorsa) sunucuya dokunulmaz — kanıt betiği
 * başkasının sürecini öldürmez.
 */
import { spawn, spawnSync } from 'node:child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isReachable = async (url) => {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.status < 500;
  } catch {
    return false;
  }
};

/** Sunucu `timeoutMs` içinde cevap verene kadar bekler. */
export const waitForServer = async (url, timeoutMs = 45000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return true;
    await sleep(300);
  }
  return false;
};

/**
 * Dev sunucusunu başlatır. Zaten ayaktaysa `null` döner ve hiçbir şey kapatılmaz.
 */
export const startDevServer = async (cwd, url) => {
  if (await isReachable(url)) {
    console.log(`dev sunucusu zaten ayakta: ${url} (kapatılmayacak)`);
    return null;
  }

  const child = spawn('npm', ['run', 'dev'], { cwd, shell: true, stdio: 'ignore' });
  const up = await waitForServer(url);
  if (!up) {
    stopDevServer(child);
    throw new Error(`dev sunucusu ${url} üzerinde ayağa kalkmadı.`);
  }
  console.log(`dev sunucusu başlatıldı: ${url}`);
  return child;
};

/** Yalnızca `startDevServer`'ın başlattığı süreç ağacını kapatır. */
export const stopDevServer = (child) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
};
