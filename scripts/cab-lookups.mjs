#!/usr/bin/env node
// Writes test/fixtures/cab-lookups.json: every Lookup and MasterDetail field in the CAB package source.
// The candidate-list test reads this file. Run it again after each CAB release:
//   node scripts/cab-lookups.mjs <path to the cab repo> [git ref ...]
// The script only reads the cab repo (git ls-tree and git show).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [repo, ...refsArg] = process.argv.slice(2);
if (!repo) {
  console.error('Usage: node scripts/cab-lookups.mjs <cab repo> [git ref ...]');
  process.exit(1);
}
const refs = refsArg.length ? refsArg : ['master'];
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

const lookups = new Map();
for (const ref of refs) {
  const files = git('ls-tree', '-r', '--name-only', ref)
    .split('\n')
    .filter((p) => /\/objects\/[^/]+\/fields\/[^/]+\.field-meta\.xml$/.test(p));
  for (const path of files) {
    const xml = git('show', `${ref}:${path}`);
    const type = tag(xml, 'type');
    if (type !== 'Lookup' && type !== 'MasterDetail') continue;
    const [, object, field] = path.match(/\/objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/);
    const key = `${object}.${field}`;
    lookups.set(key, { field: key, type, referenceTo: tag(xml, 'referenceTo') });
  }
}
const result = [...lookups.values()].sort((a, b) => a.field.localeCompare(b.field));
writeFileSync(new URL('../test/fixtures/cab-lookups.json', import.meta.url), JSON.stringify({ refs, lookups: result }, null, 2) + '\n');
console.log(`${result.length} lookups from ${refs.join(', ')}`);
