import { describe, expect, it } from 'vitest';
import { normalizePath } from './storage';

describe('normalizePath', () => {
  it('ayırıcı ve büyük/küçük harf farkını yutar', () => {
    expect(normalizePath('C:\\Users\\Serhat\\Video\\A.mp4')).toBe(
      normalizePath('c:/users/serhat/video/a.mp4'),
    );
  });

  it('sondaki ayırıcıları temizler', () => {
    expect(normalizePath('C:/temp///')).toBe('c:/temp');
  });
});
