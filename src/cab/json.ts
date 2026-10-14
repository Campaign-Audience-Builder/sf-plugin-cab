import { createHash } from 'node:crypto';

/** Returns a deep copy of a JSON value with the keys of each object in sorted order. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item as unknown)) as T;
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) sorted[key] = sortKeys(item);
    }
    return sorted as T;
  }
  return value;
}

/** Stable JSON text: sorted keys, two-space indentation, a final newline. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(value)))
    .digest('hex');
}
