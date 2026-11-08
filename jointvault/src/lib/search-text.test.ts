import { describe, expect, it } from 'vitest';
import { escapeLike, normalizeSearchText } from './search-text';

describe('normalizeSearchText', () => {
  it('Türkçe büyük/küçük harfi katlar', () => {
    expect(normalizeSearchText('ŞARKI')).toBe('sarki');
    expect(normalizeSearchText('Işık')).toBe('isik');
    expect(normalizeSearchText('İSTANBUL')).toBe('istanbul');
  });

  it('aksanları sadeleştirir', () => {
    expect(normalizeSearchText('Kafé Çöğüş')).toBe('kafe cogus');
  });

  it('boş parçaları atlar ve boşluğu toparlar', () => {
    expect(normalizeSearchText(null, '  çok   güzel  ', undefined)).toBe('cok guzel');
  });
});

describe('escapeLike', () => {
  it('% ve _ jokerlerini kaçırır', () => {
    expect(escapeLike('100%_test\\')).toBe('100\\%\\_test\\\\');
  });
});
