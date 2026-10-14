import type { Raw } from './read.js';
import { str } from './read.js';

export type LibraryMatch =
  | { status: 'matched'; targetId: string; by: 'uniqueName' | 'name' }
  | { status: 'missing' }
  /** More than one target record has the name. This counts as no match (spec). */
  | { status: 'ambiguous'; names: string[] };

/**
 * 4.8 (D12): matches a template or an outcome definition by `UniqueName__c`, then by its name when exactly
 * one target record has that name.
 */
export function matchLibrary(
  entry: { key: string; name: string },
  targets: Raw[],
  nameField: string,
  hasUniqueName: boolean
): LibraryMatch {
  if (hasUniqueName) {
    const byKey = targets.filter((t) => str(t.UniqueName__c)?.toLowerCase() === entry.key.toLowerCase());
    if (byKey.length === 1) return { status: 'matched', targetId: byKey[0].Id, by: 'uniqueName' };
  }
  const byName = targets.filter((t) => str(t[nameField])?.trim().toLowerCase() === entry.name.trim().toLowerCase());
  if (byName.length === 1) return { status: 'matched', targetId: byName[0].Id, by: 'name' };
  if (byName.length > 1) return { status: 'ambiguous', names: byName.map((t) => str(t[nameField]) ?? t.Id) };
  return { status: 'missing' };
}
