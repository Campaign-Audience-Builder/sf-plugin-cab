import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Messages, SfError } from '@salesforce/core';
import type { SfCommand } from '@salesforce/sf-plugins-core';
import { safeAlias, timestamp } from './exporter.js';
import type { MissingAnswer } from './flags.js';
import { AudienceResult, ImportRun, LibraryResult, runImport, Status } from './importer.js';
import { stableStringify } from './json.js';
import type { ExportFile } from './model.js';
import { accessError, CabOrg, checkDmlAccess, isProduction, orgLabel } from './org.js';
import { Answers, buildPlan, counts, evaluatePlan, Plan } from './plan.js';
import { renderPlan } from './render.js';
import { isInteractive, limitLines } from './ux.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'importFlow');

type Ui = Pick<SfCommand<unknown>, 'log' | 'warn' | 'spinner' | 'confirm'>;

export type ImportOptions = {
  dryRun: boolean;
  yes: boolean;
  failFast: boolean;
  missingFolders?: MissingAnswer;
  missingTemplates?: MissingAnswer;
  missingOutcomes?: MissingAnswer;
  verbose: boolean;
  json: boolean;
  pluginVersion: string;
  /** The command that runs the import again, for the summary. */
  rerunCommand: string;
};

export type ImportOutcome = {
  target: { org: string; username: string; production: boolean };
  dryRun: boolean;
  counts: Record<Status, number>;
  audiences: AudienceResult[];
  library: LibraryResult[];
  warnings: string[];
  backupFile?: string;
  reportFile?: string;
  exitCode: 0 | 1 | 68;
};

function emptyCounts(): Record<Status, number> {
  return { created: 0, updated: 0, unchanged: 0, blocked: 0, failed: 0, skipped: 0, notProcessed: 0 };
}

/** Audiences that the import writes and that use a missing template or outcome definition. */
function usersOf(plan: Plan, kind: 'template' | 'outcome', key: string): number {
  return plan.audiences.filter(
    (a) =>
      (a.action === 'create' || a.action === 'update' || a.action === 'blocked') &&
      a.entry.tree.some((n) =>
        kind === 'outcome' ? n.outcome === key : n.templateReferences.some((r) => r.template === key)
      )
  ).length;
}

type Question = {
  flag: string;
  count: number;
  noun: string;
  lines: string[];
  question: string;
  answer?: MissingAnswer;
  set(a: MissingAnswer): void;
};

/** 5.1: the questions for missing folders, templates, and outcome definitions, with their flags. */
function questions(plan: Plan, answers: Answers, opts: ImportOptions): Question[] {
  const out: Question[] = [];
  const writes = plan.audiences.filter((a) => a.action === 'create' || a.action === 'update');
  if (plan.missingFolders.length) {
    const affected = writes.filter(
      (a) =>
        a.entry.folder &&
        plan.missingFolders.some((f) => f.path === a.entry.folder || a.entry.folder!.startsWith(f.path + '/'))
    ).length;
    out.push({
      flag: '--missing-folders',
      count: plan.missingFolders.length,
      noun: 'folders',
      lines: plan.missingFolders.map((f) => `  ${f.path}`),
      question: messages.getMessage('question.folders', [affected]),
      answer: opts.missingFolders,
      set: (a) => (answers.folders = a),
    });
  }
  const missingTemplates = [...plan.templates.values()].filter(
    (t) => t.match.status !== 'matched' && usersOf(plan, 'template', t.entry.key)
  );
  const creatable = missingTemplates.filter((t) => !t.cannotCreate);
  if (missingTemplates.length) {
    const affected = writes.filter((a) =>
      a.entry.tree.some((n) =>
        n.templateReferences.some((r) => missingTemplates.some((t) => t.entry.key === r.template))
      )
    ).length;
    out.push({
      flag: '--missing-templates',
      count: missingTemplates.length,
      noun: 'Filter Library templates',
      lines: [
        `  ${missingTemplates.map((t) => t.entry.name).join(', ')}`,
        ...missingTemplates.filter((t) => t.cannotCreate).map((t) => `  ! ${t.entry.name}: ${t.cannotCreate!}`),
      ],
      question: messages.getMessage('question.templates', [affected]),
      answer: opts.missingTemplates ?? (creatable.length ? undefined : 'skip'),
      set: (a) => (answers.templates = a),
    });
  }
  const missingOutcomes = [...plan.outcomes.values()].filter(
    (o) => o.match.status !== 'matched' && usersOf(plan, 'outcome', o.entry.key)
  );
  if (missingOutcomes.length) {
    const canCreate = missingOutcomes.some((o) => !o.cannotCreate);
    const affected = plan.audiences.filter((a) =>
      a.entry.tree.some((n) => n.outcome && missingOutcomes.some((o) => o.entry.key === n.outcome))
    ).length;
    out.push({
      flag: '--missing-outcomes',
      count: missingOutcomes.length,
      noun: 'outcome definitions',
      lines: [
        `  ${missingOutcomes.map((o) => o.entry.name).join(', ')}`,
        ...(canCreate ? [] : [`  ! ${missingOutcomes[0].cannotCreate!}`]),
      ],
      question: messages.getMessage('question.outcomes', [affected]),
      // Without `create`, the only safe answer is to block the audiences, so there is no question.
      answer: opts.missingOutcomes ?? (canCreate ? undefined : 'skip'),
      set: (a) => (answers.outcomes = a),
    });
  }
  return out;
}

function backupPath(file: string, alias: string, now: Date): string {
  return join(dirname(resolve(file)), `cab-backup-${safeAlias(alias)}-${timestamp(now)}.json`);
}

function reportPath(file: string, alias: string, now: Date): string {
  return join(dirname(resolve(file)), `cab-report-${safeAlias(alias)}-${timestamp(now)}.json`);
}

/** 5.2 (D10): the backup has the export format and holds the target definitions of the audiences that the import updates. */
export function backupFile(plan: Plan, now: Date): ExportFile | undefined {
  const updated = new Set(
    plan.audiences.filter((a) => a.action === 'update').map((a) => a.entry.apiName.toLowerCase())
  );
  if (!updated.size || !plan.targetFile) return undefined;
  return {
    ...plan.targetFile,
    exportedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    audiences: plan.targetFile.audiences.filter((a) => updated.has(a.apiName.toLowerCase())),
    backup: { of: plan.target.alias, createdAudiences: [] },
  };
}

export function exitCodeOf(c: Record<Status, number>): 0 | 1 | 68 {
  const ok = c.created + c.updated;
  const bad = c.failed + c.blocked + c.skipped + c.notProcessed;
  if (!bad) return 0;
  return ok ? 68 : 1;
}

function stop(message: string, actions: string[] = []): SfError {
  return new SfError(message, 'ImportStopped', actions, 1);
}

/** The import: checks, plan, questions, backup, writes, report, and summary (audience-import spec). */
export async function runImportFlow(
  ui: Ui,
  cab: CabOrg,
  filePath: string,
  file: ExportFile,
  opts: ImportOptions
): Promise<ImportOutcome> {
  const problems = checkDmlAccess(cab.schema);
  if (problems.length) throw accessError(cab, problems);

  const answers: Answers = {
    folders: opts.missingFolders ?? 'create',
    templates: opts.missingTemplates ?? 'create',
    outcomes: opts.missingOutcomes ?? 'create',
  };
  ui.spinner.start(messages.getMessage('planning', [cab.orgName]));
  const plan = await buildPlan(cab, file, answers, opts.pluginVersion);
  ui.spinner.stop();
  const warnings = [...plan.schemaWarnings, ...plan.libraryWarnings];
  const target = { org: cab.orgName, username: cab.username, production: isProduction(cab) };
  const show = (lines: string[]): void => lines.forEach((l) => ui.log(l));
  show(renderPlan(plan, filePath, opts.verbose));

  const result = (run: ImportRun | undefined, extra: Partial<ImportOutcome> = {}): ImportOutcome => {
    const audiences = run?.audiences ?? planResults(plan);
    const c = emptyCounts();
    for (const a of audiences) c[a.status]++;
    return {
      target,
      dryRun: opts.dryRun,
      counts: c,
      audiences,
      library: run?.library ?? [],
      warnings,
      exitCode: exitCodeOf(c),
      ...extra,
    };
  };

  if (opts.dryRun) {
    ui.log('');
    ui.log(messages.getMessage('dryRun'));
    return { ...result(undefined), exitCode: 0 };
  }

  // 5.1: the questions, then the final confirmation. Every question has a flag.
  const interactive = isInteractive(opts.json);
  const qs = questions(plan, answers, opts);
  const missingFlags = qs.filter((q) => !q.answer && !interactive);
  if (missingFlags.length) {
    throw stop(missingFlags.map((q) => messages.getMessage('error.needFlag', [q.count, q.noun, q.flag])).join('\n'));
  }
  for (const q of qs) {
    let answer = q.answer;
    if (!answer) {
      ui.log('');
      ui.log(messages.getMessage('question.header', [q.count, q.noun, cab.orgName]));
      show(limitLines(q.lines, opts.verbose));
      // eslint-disable-next-line no-await-in-loop
      answer = (await ui.confirm({ message: q.question, defaultAnswer: true })) ? 'create' : 'skip';
    }
    if (answer === 'fail') throw stop(messages.getMessage('error.failAnswer', [q.count, q.noun, cab.orgName, q.flag]));
    q.set(answer);
  }
  evaluatePlan(plan, answers);
  const c = counts(plan);
  const writes = c.create + c.update;
  if (qs.some((q) => !q.answer))
    ui.log(messages.getMessage('afterAnswers', [c.create, c.update, c.unchanged, c.blocked]));
  if (!writes) {
    ui.log('');
    ui.log(messages.getMessage(c.blocked ? 'nothingBlocked' : 'nothing', [cab.orgName]));
    return result(undefined);
  }

  const now = new Date();
  const backup = backupFile(plan, now);
  const backupFileName = backup ? backupPath(filePath, cab.alias, now) : undefined;
  if (backupFileName) {
    ui.log('');
    ui.log(messages.getMessage('backupLine', [c.update, backupFileName]));
  }
  if (!opts.yes) {
    if (!interactive)
      throw stop(messages.getMessage('error.needYes', [writes, cab.orgName]), [
        messages.getMessage('error.needYes.action'),
      ]);
    const ok = await ui.confirm({
      message: messages.getMessage('confirm', [writes, orgLabel(cab), cab.username]),
      defaultAnswer: false,
    });
    if (!ok) throw stop(messages.getMessage('declined', [cab.orgName]));
  }
  if (backup && backupFileName) await writeFile(backupFileName, stableStringify(backup), 'utf8');

  // 5.9: progress, and Ctrl+C after the current audience.
  let stopRequested = false;
  const onSigint = (): void => {
    if (stopRequested) process.exit(130);
    stopRequested = true;
    ui.spinner.status = messages.getMessage('stopping');
  };
  process.on('SIGINT', onSigint);
  ui.spinner.start(messages.getMessage('importing'));
  let run: ImportRun;
  try {
    run = await runImport(plan, {
      failFast: opts.failFast,
      verbose: opts.verbose,
      now,
      onProgress: (done, total, label) => {
        ui.spinner.status = `${done}/${total} · ${label}`;
      },
      shouldStop: () => stopRequested,
    });
  } finally {
    process.off('SIGINT', onSigint);
    ui.spinner.stop();
  }

  if (backup && backupFileName) {
    backup.backup = {
      of: cab.alias,
      createdAudiences: run.audiences.filter((a) => a.status === 'created').map((a) => a.apiName),
    };
    await writeFile(backupFileName, stableStringify(backup), 'utf8');
  }
  const report = reportPath(filePath, cab.alias, now);
  const outcome = result(run, { backupFile: backupFileName, reportFile: report });
  await writeFile(
    report,
    stableStringify({
      ...outcome,
      file: resolve(filePath),
      finishedAt: new Date().toISOString(),
      stopped: run.stopped,
    }),
    'utf8'
  );
  show(summary(outcome, run, file, cab, opts));
  return outcome;
}

/** The result of each audience when nothing is written: the plan action. */
function planResults(plan: Plan): AudienceResult[] {
  return plan.audiences.map((a) => ({
    name: a.name,
    apiName: a.entry.apiName,
    status: a.action === 'blocked' ? 'blocked' : a.action === 'unchanged' ? 'unchanged' : 'notProcessed',
    planned: a.action,
    ...(a.blockers.length ? { reason: a.blockers.join(' ') } : {}),
    ...(a.target ? { targetId: a.target.id } : {}),
  }));
}

/** 5.10: the counts, the failures, the report and backup paths, and the command to run again. */
function summary(outcome: ImportOutcome, run: ImportRun, file: ExportFile, cab: CabOrg, opts: ImportOptions): string[] {
  const c = outcome.counts;
  const lines = [
    '',
    messages.getMessage('summary.counts', [c.created, c.updated, c.unchanged, c.blocked + c.skipped, c.failed]),
  ];
  if (c.notProcessed) lines.push(messages.getMessage('summary.notProcessed', [c.notProcessed]));
  for (const l of run.library)
    lines.push(
      messages.getMessage(l.status === 'created' ? 'summary.libraryCreated' : 'summary.libraryFailed', [
        l.kind,
        l.name,
        l.reason ?? '',
      ])
    );
  const problems = outcome.audiences.filter(
    (a) => a.status === 'failed' || a.status === 'blocked' || a.status === 'skipped'
  );
  if (problems.length) {
    lines.push('', messages.getMessage('summary.problems'));
    const items = problems.map(
      (a) =>
        `  ✗ ${a.name} (${a.apiName}) · ${a.status}\n      ${a.reason ?? ''}${
          opts.verbose && a.targetId ? `  [${a.targetId}]` : ''
        }`
    );
    lines.push(...limitLines(items, opts.verbose));
  }
  if (file.backup?.createdAudiences.length) {
    lines.push('', messages.getMessage('summary.restoreCreated', [file.backup.createdAudiences.length]));
    lines.push(
      ...limitLines(
        file.backup.createdAudiences.map((n) => `  ${n}`),
        opts.verbose
      )
    );
  }
  lines.push('', messages.getMessage('summary.report', [outcome.reportFile ?? '']));
  if (outcome.backupFile)
    lines.push(messages.getMessage('summary.backup', [outcome.backupFile, cab.alias, outcome.backupFile]));
  if (run.stopped && c.notProcessed) lines.push(messages.getMessage('summary.continue', [opts.rerunCommand]));
  else if (c.failed || c.blocked || c.skipped) lines.push(messages.getMessage('summary.rerun', [opts.rerunCommand]));
  return lines;
}
