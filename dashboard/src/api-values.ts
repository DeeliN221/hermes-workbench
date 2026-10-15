/** Normalize untrusted JSON at API boundaries without leaking `any` into state. */
export type JsonRecord = Record<string, unknown>;
export function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}
export function rows(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const object = record(value);
  for (const key of keys) if (Array.isArray(object[key])) return object[key];
  return [];
}
export function firstDefined(value: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) if (value[key] !== undefined) return value[key];
}
export function optionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
export function timestamp(value: unknown): number | undefined {
  const number = optionalNumber(value);
  if (number != null) return Math.abs(number) < 1e12 ? number * 1000 : number;
}
export type AuthedFetch = (url: string, init?: RequestInit) => Promise<Response>;
