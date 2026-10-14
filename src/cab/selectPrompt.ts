import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isTabKey,
  isUpKey,
  makeTheme,
  useKeypress,
  useMemo,
  usePagination,
  usePrefix,
  useState,
} from '@inquirer/core';
import { inFolder } from './selection.js';

export type PromptAudience = {
  id: string;
  name: string;
  apiName: string | null;
  folderPath: string | null;
  /** Why the audience cannot be selected, or undefined. */
  disabled?: string;
};

type Row =
  | { kind: 'folder'; path: string; depth: number; ids: string[] }
  | { kind: 'audience'; audience: PromptAudience; depth: number };

const NO_FOLDER = '(no folder)';

/** Rows grouped by folder: each folder, then its subfolders, then its audiences. Sorted by path and name. */
export function buildRows(audiences: PromptAudience[]): Row[] {
  const paths = new Set<string>();
  for (const a of audiences) {
    const parts = (a.folderPath ?? NO_FOLDER).split('/');
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  const rows: Row[] = [];
  const sortedPaths = [...paths].sort((a, b) => (a === NO_FOLDER ? 1 : b === NO_FOLDER ? -1 : a.localeCompare(b)));
  for (const path of sortedPaths) {
    const depth = path.split('/').length - 1;
    const inPath = audiences.filter(
      (a) => (path === NO_FOLDER ? !a.folderPath : inFolder(a.folderPath, path)) && !a.disabled
    );
    rows.push({ kind: 'folder', path, depth, ids: inPath.map((a) => a.id) });
    const direct = audiences
      .filter((a) => (path === NO_FOLDER ? !a.folderPath : a.folderPath === path))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const a of direct) rows.push({ kind: 'audience', audience: a, depth: depth + 1 });
  }
  return rows;
}

function matches(a: PromptAudience, term: string): boolean {
  const t = term.toLowerCase();
  return (
    a.name.toLowerCase().includes(t) ||
    (a.apiName ?? '').toLowerCase().includes(t) ||
    (a.folderPath ?? '').toLowerCase().includes(t)
  );
}

/** The rows that the search term shows: matching audiences, and the folders above them. */
export function visibleRows(rows: Row[], term: string): Row[] {
  if (!term.trim()) return rows;
  const shownFolders = new Set<string>();
  const shown = rows.filter((r) => r.kind === 'audience' && matches(r.audience, term.trim()));
  for (const r of shown) {
    if (r.kind !== 'audience') continue;
    const parts = (r.audience.folderPath ?? NO_FOLDER).split('/');
    for (let i = 1; i <= parts.length; i++) shownFolders.add(parts.slice(0, i).join('/'));
  }
  return rows.filter((r) => (r.kind === 'folder' ? shownFolders.has(r.path) : shown.includes(r)));
}

type Config = { message: string; audiences: PromptAudience[]; pageSize?: number };

/**
 * D4: a searchable checkbox list grouped by folder. Type to search, Tab to select an audience or a
 * complete folder, Enter to confirm.
 */
export const selectAudiences = createPrompt<string[], Config>((config, done) => {
  const theme = makeTheme({});
  const rows = useMemo(() => buildRows(config.audiences), [config.audiences]);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'done'>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const prefix = usePrefix({ status, theme });
  const shown = visibleRows(rows, term);
  const index = Math.min(active, Math.max(shown.length - 1, 0));

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      if (!selected.length) {
        setError('Select at least one audience with Tab.');
        return;
      }
      setStatus('done');
      done(selected);
    } else if (isUpKey(key) || isDownKey(key)) {
      rl.clearLine(0);
      rl.write(term);
      if (shown.length) setActive((index + (isUpKey(key) ? shown.length - 1 : 1)) % shown.length);
    } else if (isTabKey(key)) {
      rl.clearLine(0);
      rl.write(term);
      const row = shown[index];
      if (!row) return;
      const ids = row.kind === 'folder' ? row.ids : row.audience.disabled ? [] : [row.audience.id];
      if (!ids.length) return;
      const all = ids.every((id) => selected.includes(id));
      setSelected(all ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
      setError(undefined);
    } else {
      setTerm(rl.line);
      setActive(0);
    }
  });

  if (status === 'done') {
    return `${prefix} ${theme.style.message(config.message, status)} ${theme.style.answer(
      `${selected.length} audiences`
    )}`;
  }

  const page = usePagination({
    items: shown,
    active: index,
    pageSize: config.pageSize ?? 15,
    loop: false,
    renderItem({ item, isActive }) {
      const indent = '  '.repeat(item.depth);
      const cursor = isActive ? '❯' : ' ';
      if (item.kind === 'folder') {
        const n = item.ids.filter((id) => selected.includes(id)).length;
        const box = n === 0 ? '◯' : n === item.ids.length ? '◉' : '◐';
        const line = `${cursor} ${indent}${box} ${item.path.split('/').pop()!}/  (${item.ids.length})`;
        return isActive ? theme.style.highlight(line) : theme.style.help(line);
      }
      const a = item.audience;
      if (a.disabled) return theme.style.help(`${cursor} ${indent}  - ${a.name}  (${a.disabled})`);
      const box = selected.includes(a.id) ? '◉' : '◯';
      const line = `${cursor} ${indent}${box} ${a.name}  ${theme.style.help(a.apiName ?? '')}`;
      return isActive ? theme.style.highlight(line) : line;
    },
  });
  const header = `${prefix} ${theme.style.message(config.message, status)} ${
    term ? term : theme.style.help('(type to search)')
  }`;
  const help = theme.style.help(`↑↓ move · Tab select audience or folder · Enter done · ${selected.length} selected`);
  const body = shown.length ? page : theme.style.help('  No audience matches the search.');
  return [header, [body, help, error ? theme.style.error(error) : ''].filter(Boolean).join('\n')];
});
