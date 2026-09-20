import { describe, expect, it } from 'vitest';
import { createRetryCache } from './retry-cache';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createRetryCache', () => {
  it('aynı anda gelen çağrılar için tek yükleme yapar', async () => {
    // Arrange
    let calls = 0;
    const cache = createRetryCache(async () => {
      calls += 1;
      return 'deger';
    });

    // Act
    await Promise.all([cache.get(), cache.get(), cache.get()]);

    // Assert
    expect(calls).toBe(1);
  });

  it('başarıyı önbelleğe alır', async () => {
    // Arrange
    let calls = 0;
    const cache = createRetryCache(async () => {
      calls += 1;
      return calls;
    });

    // Act
    await cache.get();
    await cache.get();

    // Assert
    expect(calls).toBe(1);
  });

  it('BAŞARISIZLIĞI önbelleğe almaz: sonraki çağrı yeniden dener', async () => {
    /* Asıl hata buydu: reddedilen promise saklanıyordu ve oturum kilitleniyordu. */
    // Arrange
    let calls = 0;
    const cache = createRetryCache(async () => {
      calls += 1;
      if (calls === 1) throw new Error('kilitli');
      return 'kurtuldu';
    });

    // Act
    await cache.get().catch(() => undefined);
    const second = await cache.get();

    // Assert
    expect(second).toBe('kurtuldu');
  });

  it('ilk hata çağırana yine de bildirilir', async () => {
    // Arrange
    const cache = createRetryCache(async () => {
      throw new Error('kilitli');
    });

    // Act + Assert
    await expect(cache.get()).rejects.toThrow('kilitli');
  });

  it('reset sonraki çağrıda yeniden yükler', async () => {
    // Arrange
    let calls = 0;
    const cache = createRetryCache(async () => {
      calls += 1;
      return calls;
    });
    await cache.get();

    // Act
    cache.reset();
    await cache.get();

    // Assert
    expect(calls).toBe(2);
  });

  it('başarısız eşzamanlı çağrılar da tek yükleme paylaşır', async () => {
    // Arrange
    let calls = 0;
    const cache = createRetryCache(async () => {
      calls += 1;
      await flush();
      throw new Error('yok');
    });

    // Act
    await Promise.allSettled([cache.get(), cache.get()]);

    // Assert
    expect(calls).toBe(1);
  });
});
