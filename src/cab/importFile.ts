import { readFile } from 'node:fs/promises';
import { Messages, SfError } from '@salesforce/core';
import { ExportFile, FORMAT_MAJOR } from './model.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'importFile');

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Checks the structure of a parsed file. Returns the problems, at most 10. */
export function validateExportFile(data: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(data)) return ['The file does not contain a JSON object.'];
  for (const key of ['folders', 'templates', 'outcomeDefinitions', 'audiences']) {
    if (!Array.isArray(data[key])) problems.push(`"${key}" is missing or is not a list.`);
  }
  if (!isObject(data.source)) problems.push('"source" is missing.');
  const audiences = Array.isArray(data.audiences) ? (data.audiences as unknown[]) : [];
  const seen = new Set<string>();
  audiences.forEach((a, i) => {
    if (!isObject(a) || typeof a.apiName !== 'string' || !a.apiName) {
      problems.push(`Audience ${i + 1} has no "apiName".`);
      return;
    }
    const key = a.apiName.toLowerCase();
    if (seen.has(key)) problems.push(`The API name "${a.apiName}" occurs more than one time.`);
    seen.add(key);
    if (!isObject(a.fields)) problems.push(`Audience ${a.apiName} has no "fields".`);
    if (!isObject(a.version)) problems.push(`Audience ${a.apiName} has no "version".`);
    if (!Array.isArray(a.tree)) problems.push(`Audience ${a.apiName} has no "tree".`);
    if (!Array.isArray(a.components)) problems.push(`Audience ${a.apiName} has no "components".`);
  });
  return problems.slice(0, 10);
}

/** 4.1: reads an export file and checks its format version and structure. */
export async function readExportFile(path: string): Promise<ExportFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new SfError(messages.getMessage('error.read', [path]), 'FileNotReadable');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new SfError(messages.getMessage('error.json', [path, (e as Error).message]), 'InvalidFile', [
      messages.getMessage('error.json.action'),
    ]);
  }
  const format = isObject(data) && typeof data.format === 'string' ? data.format : '';
  const match = /^cab-audiences\/(\d+)$/.exec(format);
  if (!match) {
    throw new SfError(messages.getMessage('error.notExport', [path]), 'InvalidFile', [
      messages.getMessage('error.notExport.action'),
    ]);
  }
  if (Number(match[1]) > FORMAT_MAJOR) {
    throw new SfError(messages.getMessage('error.newer', [path, format]), 'NewerFormat', [
      messages.getMessage('error.newer.action'),
    ]);
  }
  const problems = validateExportFile(data);
  if (problems.length) {
    throw new SfError(
      messages.getMessage('error.invalid', [path, problems.map((p) => `  - ${p}`).join('\n')]),
      'InvalidFile',
      [messages.getMessage('error.json.action')]
    );
  }
  return data as ExportFile;
}
