import { describe, expect, it } from 'vitest';
import {
  MISSING_COMPONENT_PREFIX,
  missingComponentText,
  parseMissingComponent,
} from './components';

// Tel sözleşmesindeki bilinen id'ler (Rust `SPECS` ile aynı küme).
const KNOWN_IDS: readonly string[] = ['ffmpeg', 'ffprobe', 'yt-dlp', 'whisper'];
const UNKNOWN_ID = 'bilinmeyen-bilesen';

describe('MISSING_COMPONENT_PREFIX', () => {
  it('tel önekine çivilidir (backend MISSING_PREFIX ile aynı)', () => {
    // Arrange + Act + Assert: test literal'i çiviler; üretimde tek tanım sabittir.
    expect(MISSING_COMPONENT_PREFIX).toBe('BILESEN_EKSIK:');
  });
});

describe('parseMissingComponent', () => {
  it('her bilinen id için sinyali ayrıştırır', () => {
    for (const id of KNOWN_IDS) {
      // Arrange
      const detail = `${id} kurulu değil.`;
      const signal = `${MISSING_COMPONENT_PREFIX}${id}\n${detail}`;

      // Act
      const parsed = parseMissingComponent(signal);

      // Assert
      expect(parsed).toEqual({ id, detail });
    }
  });

  it('ayrıntı satırlarını tam olarak (trim ederek) çıkarır', () => {
    // Arrange — sinyal: başta girinti, sonda boşluk, arada satır sonu.
    // Kırpma TEK SEFERDE tüm ayrıntıya uygulanır (satır satır değil) — Rust
    // tarafındaki `parse_missing_detail` ile aynı davranış.
    const signal = `${MISSING_COMPONENT_PREFIX}ffmpeg\n  ffmpeg kurulu değil.\nİkinci satır.  `;

    // Act
    const parsed = parseMissingComponent(signal);

    // Assert
    expect(parsed).toEqual({ id: 'ffmpeg', detail: 'ffmpeg kurulu değil.\nİkinci satır.' });
  });

  it('ayrıntı satırı yoksa detail boş string olur (undefined değil)', () => {
    // Arrange
    const signal = `${MISSING_COMPONENT_PREFIX}ffmpeg`;

    // Act
    const parsed = parseMissingComponent(signal);

    // Assert
    expect(parsed).toEqual({ id: 'ffmpeg', detail: '' });
  });

  it('baştaki/sondaki boşluğu hoş görür', () => {
    // Arrange
    const signal = `  ${MISSING_COMPONENT_PREFIX}  ffmpeg  \n  detay  \n`;

    // Act
    const parsed = parseMissingComponent(signal);

    // Assert
    expect(parsed).toEqual({ id: 'ffmpeg', detail: 'detay' });
  });

  it('önek BAŞTA değilse (ortada/sonda) eşleşmez', () => {
    // Arrange
    const middle = `bir hata: ${MISSING_COMPONENT_PREFIX}ffmpeg`;
    const trailing = `ffmpeg ${MISSING_COMPONENT_PREFIX}`;

    // Act + Assert
    expect(parseMissingComponent(middle)).toBeNull();
    expect(parseMissingComponent(trailing)).toBeNull();
  });

  it('yanlış büyük/küçük harfteki öneki reddeder', () => {
    // Arrange: önek yalnızca tam harf sırasıyla eşleşir (fail closed).
    const signal = 'bilesen_eksik:ffmpeg';

    // Act
    const parsed = parseMissingComponent(signal);

    // Assert
    expect(parsed).toBeNull();
  });

  it('çıplak önek ya da boş id için null döner', () => {
    // Arrange
    const bare = MISSING_COMPONENT_PREFIX;
    const spaces = `${MISSING_COMPONENT_PREFIX}   `;
    const newlineOnly = `${MISSING_COMPONENT_PREFIX}\ndetay`;

    // Act + Assert
    expect(parseMissingComponent(bare)).toBeNull();
    expect(parseMissingComponent(spaces)).toBeNull();
    expect(parseMissingComponent(newlineOnly)).toBeNull();
  });

  it('string olmayan girdilerde throw etmez, null döner', () => {
    // Arrange: Tauri düz string reddeder ama çağıran her şeyi geçirebilir.
    const inputs: readonly unknown[] = [
      undefined,
      null,
      42,
      [],
      {},
      new Error('sıradan hata'),
    ];

    // Act + Assert
    for (const input of inputs) {
      expect(parseMissingComponent(input)).toBeNull();
    }
  });

  it('Error mesajını string gibi normalleştirir', () => {
    // Arrange
    const error = new Error(`${MISSING_COMPONENT_PREFIX}ffmpeg\ndetay`);

    // Act
    const parsed = parseMissingComponent(error);

    // Assert
    expect(parsed).toEqual({ id: 'ffmpeg', detail: 'detay' });
  });
});

describe('missingComponentText', () => {
  it('detail varsa onu döndürür', () => {
    // Arrange
    const parsed = { id: 'ffmpeg', detail: 'özelleştirilmiş cümle' };

    // Act
    const text = missingComponentText(parsed);

    // Assert
    expect(text).toBe('özelleştirilmiş cümle');
  });

  it('detail yoksa bilinen id için sabit Türkçe cümle döndürür', () => {
    // Arrange + Act + Assert
    expect(missingComponentText({ id: 'ffmpeg', detail: '' })).toContain('ffmpeg kurulu değil');
    expect(missingComponentText({ id: 'ffprobe', detail: '' })).toContain('ffprobe kurulu değil');
    expect(missingComponentText({ id: 'yt-dlp', detail: '' })).toContain('yt-dlp kurulu değil');
    expect(missingComponentText({ id: 'whisper', detail: '' })).toContain('Whisper motoru kurulu değil');
  });

  it('bilinmeyen id için dürüst genel cümle döndürür', () => {
    // Arrange + Act
    const text = missingComponentText({ id: UNKNOWN_ID, detail: '' });

    // Assert
    expect(text).toContain(UNKNOWN_ID);
    expect(text).toContain('Bileşenler');
  });

  it('üretilen metin hiçbir id ve ayrıntıda öneki içermez', () => {
    // Arrange: tüm id'ler + bilinmeyen, hem boş hem önek sızdırmaya çalışan ayrıntıyla.
    for (const id of [...KNOWN_IDS, UNKNOWN_ID]) {
      for (const detail of ['', `${MISSING_COMPONENT_PREFIX}${id} sızıntı`]) {
        // Act
        const text = missingComponentText({ id, detail });

        // Assert
        expect(text).not.toContain(MISSING_COMPONENT_PREFIX);
      }
    }
  });

  it('id içine gömülü işaretçiyi de sıyırır', () => {
    // Arrange: bozuk bir sinyal id'ye önek gömerse bile metne sızmamalı.
    const parsed = { id: `${MISSING_COMPONENT_PREFIX}ffmpeg`, detail: '' };

    // Act
    const text = missingComponentText(parsed);

    // Assert
    expect(text).not.toContain('BILESEN_EKSIK');
  });
});
