export const PAGE_SIZES = [24, 48, 96] as const;

export function readPageSize(): number {
  const v = Number.parseInt(localStorage.getItem('jv-page-size') ?? '', 10);
  return (PAGE_SIZES as readonly number[]).includes(v) ? v : 48;
}
