import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, isSafeExternalUrl } from './urls';

describe('canonicalizeUrl', () => {
  it('twitter.com ve x.com aynı anahtara iner', () => {
    expect(canonicalizeUrl('https://twitter.com/user/status/1')).toBe(
      canonicalizeUrl('https://x.com/user/status/1'),
    );
  });

  it('youtu.be ve watch?v= aynı anahtara iner', () => {
    expect(canonicalizeUrl('https://youtu.be/abc')).toBe(
      'https://www.youtube.com/watch?v=abc',
    );
  });

  it('sondaki eğik çizgiyi ve büyük harf hostu normalize eder', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/a/')).toBe('https://example.com/a');
  });
});

describe('isSafeExternalUrl', () => {
  it('http ve https kabul edilir', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('file, javascript ve bozuk adresler reddedilir', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/System32')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});
