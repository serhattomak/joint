/*
 * Pano erişimi — sonuç şeklinde, sessiz kalmayan API.
 *
 * Neden gerekli: `clipboard-manager` plugin'inin `default` izin seti **boştur**
 * ("clipboard can be inherently dangerous"). Okuma/yazma ancak açıkça izin
 * verilirse çalışır. İzin eksikken çağrı reddederdi ve bu red görünmezdi:
 * pano izleyici sessizce ölür, "kopyala" düğmesi hiçbir şey yapmaz.
 *
 * Burada hata fırlatılmaz; sonuç döner. Bildirimi çağıran karar verir, çünkü
 * izleyici 2,5 sn'de bir okur — her turda bildirim göstermek doğru olmaz.
 */
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { describeError } from './errors';

export type ClipboardRead = { ok: true; text: string } | { ok: false; error: string };
export type ClipboardWrite = { ok: true } | { ok: false; error: string };

export async function readClipboardText(): Promise<ClipboardRead> {
  try {
    return { ok: true, text: await readText() };
  } catch (error) {
    return { ok: false, error: describeError(error, 'Pano okunamadı.') };
  }
}

export async function writeClipboardText(text: string): Promise<ClipboardWrite> {
  try {
    await writeText(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, 'Panoya yazılamadı.') };
  }
}
