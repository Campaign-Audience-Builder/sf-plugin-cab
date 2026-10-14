import { mostSimilar } from './similar.js';

export type Selectable = {
  id: string;
  name: string;
  apiName: string | null;
  folderPath: string | null;
  /** Ids of the audiences that this sequence uses, in order. Empty for a Standard audience. */
  componentIds: string[];
};

export type SelectionFlags = { all?: boolean; names?: string[]; folders?: string[] };

export type SelectionProblem =
  | { kind: 'notFound'; value: string; similar: string[] }
  | { kind: 'ambiguous'; value: string; matches: Array<{ name: string; apiName: string | null }> }
  | { kind: 'folderNotFound'; value: string; similar: string[] };

export function hasSelection(flags: SelectionFlags): boolean {
  return Boolean(flags.all) || Boolean(flags.names?.length) || Boolean(flags.folders?.length);
}

export function normalizePath(path: string): string {
  return path
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

/** True if the audience is in the folder or in one of its subfolders. */
export function inFolder(audiencePath: string | null, folder: string): boolean {
  if (!audiencePath) return false;
  const a = normalizePath(audiencePath);
  const f = normalizePath(folder);
  return a === f || a.startsWith(f + '/');
}

/**
 * 3.2: resolves --all, --name, and --folder to audience Ids. A --name value matches the API name first
 * and the name second. Problems are collected, so the admin sees all of them in one message.
 */
export function resolveSelection(
  audiences: Selectable[],
  flags: SelectionFlags,
  folderPaths: string[]
): { ids: Set<string>; problems: SelectionProblem[] } {
  const ids = new Set<string>();
  const problems: SelectionProblem[] = [];
  if (flags.all) {
    for (const a of audiences) ids.add(a.id);
    return { ids, problems };
  }
  for (const value of flags.names ?? []) {
    const v = value.trim().toLowerCase();
    const byApi = audiences.filter((a) => a.apiName?.toLowerCase() === v);
    const matches = byApi.length ? byApi : audiences.filter((a) => a.name.trim().toLowerCase() === v);
    if (matches.length === 1) ids.add(matches[0].id);
    else if (matches.length > 1)
      problems.push({ kind: 'ambiguous', value, matches: matches.map((m) => ({ name: m.name, apiName: m.apiName })) });
    else
      problems.push({
        kind: 'notFound',
        value,
        similar: mostSimilar(
          value,
          audiences.flatMap((a) => [a.name])
        ),
      });
  }
  for (const folder of flags.folders ?? []) {
    const known = folderPaths.some((p) => normalizePath(p) === normalizePath(folder));
    if (!known) {
      problems.push({ kind: 'folderNotFound', value: folder, similar: mostSimilar(folder, folderPaths) });
      continue;
    }
    for (const a of audiences) if (inFolder(a.folderPath, folder)) ids.add(a.id);
  }
  return { ids, problems };
}

export type ClosureResult = {
  ids: Set<string>;
  /** For each selected sequence, the audiences that the closure added because of it. */
  added: Map<string, string[]>;
  /** Sequences that use themselves through their components. */
  cycles: string[][];
};

/** 3.3: adds every audience that a selected sequence uses, at all levels of nesting. */
export function sequenceClosure(audiences: Map<string, Selectable>, selected: Set<string>): ClosureResult {
  const ids = new Set(selected);
  const added = new Map<string, string[]>();
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  const walk = (id: string, path: string[], root: string): void => {
    const a = audiences.get(id);
    if (!a) return;
    for (const c of a.componentIds) {
      if (path.includes(c)) {
        const cycle = [...path.slice(path.indexOf(c)), c];
        const key = [...cycle].sort().join(',');
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push(cycle);
        }
        continue;
      }
      if (!ids.has(c)) {
        ids.add(c);
        added.set(root, [...(added.get(root) ?? []), c]);
      }
      walk(c, [...path, c], root);
    }
  };
  for (const id of selected) walk(id, [id], id);
  return { ids, added, cycles };
}

export type Skip = { id: string; reason: string; cause?: string };

/**
 * 3.4: skips each audience without an API name, each sequence that uses a skipped audience at any level,
 * and each audience in a cycle.
 */
export function exportSkips(
  audiences: Map<string, Selectable>,
  ids: Set<string>,
  cycles: string[][]
): Map<string, Skip> {
  const skips = new Map<string, Skip>();
  for (const id of ids) {
    const a = audiences.get(id);
    if (a && !a.apiName) skips.set(id, { id, reason: 'noApiName' });
  }
  for (const cycle of cycles) for (const id of cycle) if (!skips.has(id)) skips.set(id, { id, reason: 'cycle' });
  // Propagate to the sequences that use a skipped audience, until nothing changes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (skips.has(id)) continue;
      const a = audiences.get(id);
      const cause = a?.componentIds.find((c) => skips.has(c) || !audiences.has(c));
      if (cause) {
        skips.set(id, { id, reason: 'usesSkipped', cause });
        changed = true;
      }
    }
  }
  return skips;
}
