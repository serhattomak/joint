import { describe, expect, it } from 'vitest';
import { isHealthReport, isTranscriptData, isWhisperStatus } from './backend-contracts';

const VALID_HEALTH = {
  ffmpeg: { available: true, version: '6.1' },
  ffprobe: { available: true, version: null },
  whisper: { available: false },
  models: { tiny: true, base: false, small: false, 'large-v3-q5_0': false, 'large-v3': false },
  download_dir: 'D:/vault',
};

describe('isHealthReport', () => {
  it('geçerli sağlık raporunu kabul eder', () => {
    // Arrange + Act
    const result = isHealthReport(VALID_HEALTH);

    // Assert
    expect(result).toBe(true);
  });

  it('ffprobe alanı eksikse reddeder', () => {
    // Arrange
    const { ffprobe: _dropped, ...withoutFfprobe } = VALID_HEALTH;

    // Act
    const result = isHealthReport(withoutFfprobe);

    // Assert
    expect(result).toBe(false);
  });

  it('version null yerine sayı geldiğinde reddeder', () => {
    // Arrange
    const broken = { ...VALID_HEALTH, ffmpeg: { available: true, version: 6 } };

    // Act
    const result = isHealthReport(broken);

    // Assert
    expect(result).toBe(false);
  });

  it('model bayrağı boolean değilse reddeder', () => {
    // Arrange
    const broken = {
      ...VALID_HEALTH,
      models: { tiny: true, base: 'yok', small: false, 'large-v3-q5_0': false, 'large-v3': false },
    };

    // Act
    const result = isHealthReport(broken);

    // Assert
    expect(result).toBe(false);
  });

  it('null girdiyi reddeder', () => {
    expect(isHealthReport(null)).toBe(false);
  });

  it('dizi girdiyi reddeder', () => {
    expect(isHealthReport([])).toBe(false);
  });
});

describe('isWhisperStatus', () => {
  const VALID = {
    whisper_available: true,
    models: { tiny: true, base: true, small: false, 'large-v3-q5_0': false, 'large-v3': false },
    models_dir: 'C:/models',
  };

  it('geçerli konuşma durumunu kabul eder', () => {
    expect(isWhisperStatus(VALID)).toBe(true);
  });

  it('models_dir string değilse reddeder', () => {
    // Arrange
    const broken = { ...VALID, models_dir: 42 };

    // Act
    const result = isWhisperStatus(broken);

    // Assert
    expect(result).toBe(false);
  });
});

describe('isTranscriptData', () => {
  it('geçerli transkripti kabul eder', () => {
    // Arrange
    const valid = { srt_path: 'a.srt', preview: 'merhaba', language: 'tr' };

    // Act
    const result = isTranscriptData(valid);

    // Assert
    expect(result).toBe(true);
  });

  it('preview alanı eksikse reddeder', () => {
    // Arrange
    const broken = { srt_path: 'a.srt', language: 'tr' };

    // Act
    const result = isTranscriptData(broken);

    // Assert
    expect(result).toBe(false);
  });
});
