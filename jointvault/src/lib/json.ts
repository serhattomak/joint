/*
 * JSON sınırı yardımcıları.
 *
 * `JSON.parse(raw) as X` tip sistemini susturur ama hiçbir şey doğrulamaz:
 * backend şekli değişirse hata, çağrının çok uzağında ve anlaşılmaz biçimde
 * patlar. Doğrulama sınırda yapılır; buradaki yardımcılar onu okunur kılar.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

export const isString = (value: unknown): value is string => typeof value === 'string';

export const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
