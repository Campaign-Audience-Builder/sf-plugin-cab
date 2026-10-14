import { basename } from 'node:path';
import { Messages } from '@salesforce/core';
import { orgLine } from './org.js';
import { counts, Plan } from './plan.js';
import { limitLines } from './ux.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'render');

function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sourceLabel(plan: Plan): string {
  const s = plan.file.source;
  return s.isSandbox ? `${s.org} (sandbox)` : s.org;
}

/** 4.10 (D3): the plan screen. Numbers first, then lists of at most 10 lines (all lines with --verbose). */
export function renderPlan(plan: Plan, filePath: string, verbose: boolean): string[] {
  const c = counts(plan);
  const width = String(Math.max(c.create, c.update, c.unchanged, c.blocked, plan.targetOnly)).length;
  const num = (n: number): string => `  ${String(n).padStart(width)}`;
  const lines: string[] = [
    `Target   ${orgLine(plan.target)}`,
    `File     ${basename(filePath)} · ${plan.file.audiences.length} audiences from ${sourceLabel(plan)} · ${localTime(
      plan.file.exportedAt
    )}`,
    '',
    'Plan',
    `${num(c.create)}  create`,
    `${num(c.update)}  update`,
    `${num(c.unchanged)}  unchanged (skipped)`,
    `${num(c.blocked)}  blocked`,
    `${num(plan.targetOnly)}  ${messages.getMessage('targetOnly', [plan.target.orgName])}`,
  ];

  const blocked = plan.audiences.filter((a) => a.action === 'blocked');
  if (blocked.length) {
    lines.push('', 'Blocked');
    const items = blocked.map((a) => [`  ✗ ${a.label}`, ...a.blockers.map((b) => `      ${b}`)].join('\n'));
    lines.push(...limitLines(items, verbose));
  }

  const warnings: string[] = [...plan.schemaWarnings, ...plan.libraryWarnings].map((w) => `  ! ${w}`);
  if (plan.idLikeValues.length) {
    const details = plan.idLikeValues.map((v) => `      ${v.audience}: ${v.field} = ${v.object} Id ${v.value}`);
    warnings.push(
      `  ! ${messages.getMessage('idLike', [plan.idLikeValues.length])}${
        verbose ? '' : '        (details: --verbose)'
      }${verbose ? '\n' + details.join('\n') : ''}`
    );
  }
  for (const a of plan.audiences) {
    if (a.action !== 'create' && a.action !== 'update') continue;
    for (const w of a.warnings) warnings.push(`  ! ${a.label}: ${w}`);
  }
  if (warnings.length) {
    lines.push('', 'Warnings');
    lines.push(...limitLines(warnings, verbose));
  }
  if (verbose) {
    const changes = plan.audiences.filter((a) => a.action === 'create' || a.action === 'update');
    if (changes.length) {
      lines.push('', 'Changes');
      for (const a of changes)
        lines.push(`  ${a.action === 'create' ? '+' : '~'} ${a.label}${a.target ? `  [${a.target.id}]` : ''}`);
    }
  }
  return lines;
}
