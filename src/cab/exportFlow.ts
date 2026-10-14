import { Messages, SfError } from '@salesforce/core';
import type { SfCommand } from '@salesforce/sf-plugins-core';
import { buildExport, Catalog, defaultExportPath, fileExists, loadCatalog, writeExportFile } from './exporter.js';
import type { ExportFile } from './model.js';
import type { CabOrg } from './org.js';
import { selectAudiences } from './selectPrompt.js';
import {
  exportSkips,
  hasSelection,
  resolveSelection,
  SelectionFlags,
  SelectionProblem,
  sequenceClosure,
  Skip,
} from './selection.js';
import { audienceLabel, isInteractive, limitLines } from './ux.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'export');
const reasons = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'reasons');

export type ExportedAudience = {
  name: string;
  apiName: string | null;
  status: 'exported' | 'skipped';
  reason?: string;
};

export type ExportOutcome = {
  path: string;
  file: ExportFile;
  audiences: ExportedAudience[];
  /** True if an audience that the admin selected by name or folder was skipped. */
  partial: boolean;
  warnings: string[];
};

type Ui = Pick<SfCommand<unknown>, 'log' | 'warn' | 'spinner' | 'confirm'>;

export type ExportOptions = SelectionFlags & {
  outputFile?: string;
  overwrite?: boolean;
  verbose: boolean;
  json: boolean;
  pluginVersion: string;
  now?: Date;
};

function selectionError(problems: SelectionProblem[], cab: CabOrg): SfError {
  const lines = problems.map((p) => {
    switch (p.kind) {
      case 'ambiguous':
        return messages.getMessage('error.ambiguous', [
          p.value,
          p.matches.map((m) => `    ${audienceLabel(m.name, m.apiName ?? '(no API name)')}`).join('\n'),
        ]);
      case 'notFound':
        return messages.getMessage('error.notFound', [cab.orgName, p.value, p.similar.join(', ') || '-']);
      case 'folderNotFound':
        return messages.getMessage('error.folderNotFound', [cab.orgName, p.value, p.similar.join(', ') || '-']);
    }
  });
  return new SfError(lines.join('\n'), 'SelectionProblem', [
    messages.getMessage('error.selection.action', [cab.alias]),
  ]);
}

/** Resolves the selection: from the flags, or from the interactive list (D4). */
async function select(
  cab: CabOrg,
  catalog: Catalog,
  opts: ExportOptions
): Promise<{ ids: Set<string>; byFlags: boolean }> {
  if (hasSelection(opts)) {
    const folderPaths = [...catalog.folders.values()].map((f) => f.path);
    const { ids, problems } = resolveSelection([...catalog.selectables.values()], opts, folderPaths);
    if (problems.length) throw selectionError(problems, cab);
    return { ids, byFlags: !opts.all };
  }
  if (!isInteractive(opts.json)) {
    throw new SfError(
      messages.getMessage('error.noSelection'),
      'NoSelection',
      messages.getMessages('error.noSelection.actions')
    );
  }
  const all = new Set(catalog.audiences.map((a) => a.id));
  const skips = exportSkips(catalog.selectables, all, sequenceClosure(catalog.selectables, all).cycles);
  const chosen = await selectAudiences({
    message: messages.getMessage('prompt.select', [cab.orgName]),
    audiences: catalog.audiences.map((a) => ({
      id: a.id,
      name: a.name,
      apiName: a.apiName,
      folderPath: a.folderPath,
      disabled: skips.has(a.id) ? 'cannot be exported' : undefined,
    })),
  });
  return { ids: new Set(chosen), byFlags: true };
}

/** Lists the skipped audiences with their reasons (3.4). */
function reportSkips(
  ui: Ui,
  cab: CabOrg,
  catalog: Catalog,
  ids: Set<string>,
  skips: Map<string, Skip>,
  byFlags: boolean,
  verbose: boolean
): { audiences: ExportedAudience[]; partial: boolean } {
  const nameOf = (id: string): string => {
    const a = catalog.byId.get(id);
    return a ? audienceLabel(a.name, a.apiName) : id;
  };
  const reasonOf = (skip: Skip): string => {
    if (skip.reason === 'noApiName') return messages.getMessage('skip.noApiName');
    if (skip.reason === 'usesSkipped' && skip.cause) {
      return skips.get(skip.cause)?.reason === 'noApiName'
        ? messages.getMessage('skip.usesNoApiName', [nameOf(skip.cause), nameOf(skip.cause), cab.orgName])
        : messages.getMessage('skip.usesSkipped', [nameOf(skip.cause)]);
    }
    return reasons.getMessage(skip.reason, ['']);
  };
  const audiences: ExportedAudience[] = [];
  const skipLines: string[] = [];
  let noApiName = 0;
  for (const id of ids) {
    const a = catalog.byId.get(id);
    if (!a) continue;
    const skip = skips.get(id);
    if (!skip) {
      audiences.push({ name: a.name, apiName: a.apiName, status: 'exported' });
      continue;
    }
    const reason = reasonOf(skip);
    audiences.push({ name: a.name, apiName: a.apiName, status: 'skipped', reason });
    // With --all, audiences without an API name are not part of "every exportable audience".
    if (!byFlags && skip.reason === 'noApiName') noApiName++;
    else skipLines.push(`  ✗ ${nameOf(id)}\n      ${reason}`);
  }
  if (skipLines.length) {
    ui.log(messages.getMessage('info.skipped', [skipLines.length]));
    for (const line of limitLines(skipLines, verbose)) ui.log(line);
  }
  if (noApiName) ui.log(messages.getMessage('info.noApiNameAll', [noApiName, cab.alias]));
  return { audiences, partial: byFlags && skipLines.length > 0 };
}

/** Export: selection, sequence closure, skips, the file, and the messages (audience-export spec). */
export async function runExport(ui: Ui, cab: CabOrg, opts: ExportOptions): Promise<ExportOutcome> {
  const now = opts.now ?? new Date();
  ui.spinner.start(messages.getMessage('reading', [cab.orgName]));
  const catalog = await loadCatalog(cab);
  ui.spinner.stop();

  const { ids: selected, byFlags } = await select(cab, catalog, opts);
  const closure = sequenceClosure(catalog.selectables, selected);
  const plainName = (id: string): string => catalog.byId.get(id)?.name ?? id;
  for (const [sequence, added] of closure.added) {
    ui.log(messages.getMessage('info.added', [added.length, plainName(sequence), added.map(plainName).join(', ')]));
  }

  const skips = exportSkips(catalog.selectables, closure.ids, closure.cycles);
  const { audiences, partial } = reportSkips(ui, cab, catalog, closure.ids, skips, byFlags, opts.verbose);
  const warnings: string[] = [];

  const exportIds = [...closure.ids].filter((id) => !skips.has(id));
  if (!exportIds.length) throw new SfError(messages.getMessage('error.nothing'), 'NothingToExport');

  const path = opts.outputFile ?? defaultExportPath(cab.alias, now);
  if (fileExists(path) && !opts.overwrite) {
    const ok =
      isInteractive(opts.json) &&
      (await ui.confirm({ message: messages.getMessage('prompt.overwrite', [path]), defaultAnswer: false }));
    if (!ok)
      throw new SfError(messages.getMessage('error.exists', [path]), 'FileExists', [
        messages.getMessage('error.exists.action'),
      ]);
  }

  ui.spinner.start(messages.getMessage('building', [exportIds.length]));
  const build = await buildExport(cab, catalog, exportIds, opts.pluginVersion, now);
  await writeExportFile(path, build.file);
  ui.spinner.stop();

  if (build.idLikeValues.length) {
    const lines = build.idLikeValues.map((v) =>
      messages.getMessage('warn.idLike.line', [audienceLabel(v.audience, v.apiName), v.field, v.object, v.value])
    );
    warnings.push(messages.getMessage('warn.idLike', [build.idLikeValues.length]), ...lines);
    ui.warn(messages.getMessage('warn.idLike', [build.idLikeValues.length]));
    for (const line of limitLines(lines, opts.verbose)) ui.log(line);
  }
  for (const name of build.duplicateKeys) {
    const w = messages.getMessage('warn.duplicateKey', [name]);
    warnings.push(w);
    ui.warn(w);
  }
  ui.log(
    messages.getMessage('info.written', [
      build.file.audiences.length,
      build.file.templates.length,
      build.file.outcomeDefinitions.length,
      build.file.folders.length,
      path,
    ])
  );
  return { path, file: build.file, audiences, partial, warnings };
}
