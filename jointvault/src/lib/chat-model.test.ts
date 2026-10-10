import { describe, expect, it } from 'vitest';
import { recommendChatModel } from './chat-model';

const MIB = 1024;

/*
 * Donanım tabanı kararı: hangi makinede hangi model. Sınırlar (16/32 GB RAM,
 * 8 GB VRAM) kritik — bir kayma, düşük donanıma ağır model önerir.
 */
describe('recommendChatModel', () => {
  it('VRAM yoksa (GPU yok/bilinmiyor) en hafif modeli önerir', () => {
    expect(recommendChatModel(64 * MIB, null).id).toBe('ai-model-llm-3b');
    expect(recommendChatModel(64 * MIB, 0).id).toBe('ai-model-llm-3b');
  });

  it('VRAM var ama RAM okunamadıysa güvenli tarafta 3B önerir', () => {
    expect(recommendChatModel(null, 16 * MIB).id).toBe('ai-model-llm-3b');
  });

  it('RAM < 16 GB ise 3B önerir (sınır: tam 16 GB değil)', () => {
    expect(recommendChatModel(8 * MIB, 16 * MIB).id).toBe('ai-model-llm-3b');
    expect(recommendChatModel(15 * MIB, 16 * MIB).id).toBe('ai-model-llm-3b');
  });

  it('RAM 16–32 GB arası 7B önerir (alt sınır dâhil, üst hariç)', () => {
    expect(recommendChatModel(16 * MIB, 16 * MIB).id).toBe('ai-model-llm-7b');
    expect(recommendChatModel(31 * MIB, 16 * MIB).id).toBe('ai-model-llm-7b');
  });

  it('RAM ≥ 32 GB ama VRAM < 8 GB ise 7B önerir', () => {
    expect(recommendChatModel(64 * MIB, 4 * MIB).id).toBe('ai-model-llm-7b');
    expect(recommendChatModel(64 * MIB, 7 * MIB).id).toBe('ai-model-llm-7b');
  });

  it('RAM ≥ 32 GB + VRAM ≥ 8 GB ise 14B önerir', () => {
    expect(recommendChatModel(32 * MIB, 8 * MIB).id).toBe('ai-model-llm');
    expect(recommendChatModel(64 * MIB, 16 * MIB).id).toBe('ai-model-llm');
  });

  it('her dalda uydurma iddia yok — kimlik kayıttaki CHAT_MODEL_IDS ile uyumlu', () => {
    const known = new Set(['ai-model-llm-3b', 'ai-model-llm-7b', 'ai-model-llm']);
    for (const [ram, vram] of [
      [null, null],
      [8 * MIB, null],
      [16 * MIB, 16 * MIB],
      [64 * MIB, 16 * MIB],
    ] as const) {
      expect(known.has(recommendChatModel(ram, vram).id)).toBe(true);
    }
  });
});
