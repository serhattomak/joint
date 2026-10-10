/**
 * Donanıma göre sohbet modeli önerisi (saf, test edilebilir).
 *
 * Kural — en hafiften yetenekliye:
 *   - GPU/VRAM yok  → 3B (her makinede akıcı; donanım tabanı)
 *   - RAM okunamadı → 3B (güvenli taraf)
 *   - RAM < 16 GB   → 3B
 *   - RAM < 32 GB   → 7B
 *   - RAM ≥ 32 GB + VRAM ≥ 8 GB → 14B; VRAM yetersizse 7B
 *
 * Hiçbir dalda uydurma donanım iddiası yok; öneri yalnızca TESPİT edilene dayanır.
 * Model kimlikleri `components.rs::CHAT_MODEL_IDS` ile birebir olmalıdır.
 */
const MIB = 1024;

export interface ChatModelRecommendation {
  id: string;
  label: string;
  reason: string;
}

export function recommendChatModel(
  ramMb: number | null,
  vramMb: number | null,
): ChatModelRecommendation {
  const gb = (mb: number): string => (mb / MIB).toFixed(0);
  const hasVram = vramMb !== null && vramMb > 0;
  if (!hasVram) {
    return {
      id: 'ai-model-llm-3b',
      label: 'Qwen 2.5 3B',
      reason: 'GPU/VRAM tespit edilemedi — her makinede akıcı çalışan hafif model önerilir.',
    };
  }
  if (ramMb === null) {
    return {
      id: 'ai-model-llm-3b',
      label: 'Qwen 2.5 3B',
      reason: 'RAM okunamadı — güvenli tarafta hafif model önerilir.',
    };
  }
  if (ramMb < 16 * MIB) {
    return {
      id: 'ai-model-llm-3b',
      label: 'Qwen 2.5 3B',
      reason: `RAM ${gb(ramMb)} GB — hafif model en akıcı sonucu verir.`,
    };
  }
  if (ramMb < 32 * MIB || vramMb < 8 * MIB) {
    return {
      id: 'ai-model-llm-7b',
      label: 'Qwen 2.5 7B',
      reason: `RAM ${gb(ramMb)} GB — hız/doğruluk dengesi için önerilir.`,
    };
  }
  return {
    id: 'ai-model-llm',
    label: 'Qwen 2.5 14B',
    reason: `RAM ${gb(ramMb)} GB + ${gb(vramMb)} GB VRAM — en yetenekli model.`,
  };
}
