import { describe, expect, it } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
  it('Error mesajını döndürür', () => {
    // Arrange
    const error = new Error('dosya bulunamadı');

    // Act
    const result = describeError(error);

    // Assert
    expect(result).toBe('dosya bulunamadı');
  });

  it('boş olmayan string hatayı olduğu gibi döndürür', () => {
    // Arrange: Tauri komutları bazen düz string fırlatır.
    const error = 'izin reddedildi';

    // Act
    const result = describeError(error);

    // Assert
    expect(result).toBe('izin reddedildi');
  });

  it('boş string için yedek metne düşer', () => {
    // Arrange
    const error = '   ';

    // Act
    const result = describeError(error, 'yedek');

    // Assert
    expect(result).toBe('yedek');
  });

  it('mesajı boş Error için yedek metne düşer', () => {
    // Arrange
    const error = new Error('');

    // Act
    const result = describeError(error, 'yedek');

    // Assert
    expect(result).toBe('yedek');
  });

  it('tanınmayan değer için varsayılan metni döndürür', () => {
    // Arrange
    const error = { code: 42 };

    // Act
    const result = describeError(error);

    // Assert
    expect(result).toBe('bilinmeyen hata');
  });
});
