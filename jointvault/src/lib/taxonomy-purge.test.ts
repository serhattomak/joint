import { describe, expect, it } from 'vitest';
import { purgeConfirmText, purgeDecision, purgePreview } from './taxonomy-purge';

describe('purgePreview', () => {
  it('kategori adedini ve etkilenen kayıtları ayrı ayrı sayar', () => {
    const p = purgePreview([{ count: 5 }, { count: 0 }, { count: 3 }], 12);
    expect(p.count).toBe(3); // "kullanılmayanlar" dahil TÜMÜ
    expect(p.affectedItems).toBe(12);
    expect(p.canPurge).toBe(true);
  });

  it('kategori yoksa devre dışı bırakır', () => {
    const p = purgePreview([], 0);
    expect(p.canPurge).toBe(false);
  });
});

describe('purgeDecision', () => {
  const dolu = purgePreview([{ count: 3 }], 10);

  it('yedek alındıysa uygular', () => {
    expect(purgeDecision(dolu, true)).toEqual({ ok: true, reason: null });
  });

  it('YEDEKSİZ uygulamaz — geri alınamaz işlem', () => {
    const d = purgeDecision(dolu, false);
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('Yedek');
  });

  it('boş listede uygulamaz', () => {
    const d = purgeDecision(purgePreview([], 0), true);
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('yok');
  });
});

describe('purgeConfirmText', () => {
  it('bağ varsa "kayıtların kendisi silinmez" der (kullanıcı yanlış anlamasın)', () => {
    // 12 kategori = 12 satır; her satırın `count` alanı o kategorinin taşıdığı
    // kayıt sayısı (burada toplam etkilenen 34).
    const rows = Array.from({ length: 12 }, (_, i) => ({ count: i < 10 ? 3 : 4 }));
    const t = purgeConfirmText('categories', purgePreview(rows, 34));
    expect(t).toContain('12 kategori');
    expect(t).toContain('34 kayıt');
    expect(t).toContain('SİLİNMEZ');
    expect(t).toContain('geri alınamaz');
  });

  it('bağ yoksa "kayıt etkilenmez" der (uydurma sayı yok)', () => {
    const t = purgeConfirmText('tags', purgePreview(Array.from({ length: 5 }, () => ({ count: 0 })), 0));
    expect(t).toContain('5 etiket');
    expect(t).toContain('kayıt etkilenmez');
    expect(t).not.toContain('0 kayıt bağlantısı');
  });

  it('binlik ayrımı tr biçiminde yazar', () => {
    const rows = Array.from({ length: 1234 }, () => ({ count: 4 }));
    const t = purgeConfirmText('categories', purgePreview(rows, 5000));
    expect(t).toContain('1.234 kategori');
    expect(t).toContain('5.000 kayıt');
  });
});