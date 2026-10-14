import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertAudience, convertTree, KeyResolver, toFileRecord } from './convert.js';
import { stableStringify } from './json.js';
import { ExportFile, FileFolder, FileNode, FileOutcome, FileTemplate, FORMAT } from './model.js';
import type { CabOrg } from './org.js';
import {
  AudienceHeader,
  Folder,
  loadAudiences,
  loadComponents,
  loadFolders,
  loadTrees,
  loadVersions,
  queryIn,
  Raw,
  RawTree,
  selectFields,
  str,
} from './read.js';
import type { Selectable } from './selection.js';

/** Everything about the audiences of an org that selection needs, without the filter trees. */
export type Catalog = {
  folders: Map<string, Folder>;
  audiences: AudienceHeader[];
  byId: Map<string, AudienceHeader>;
  components: Map<string, Raw[]>;
  selectables: Map<string, Selectable>;
};

export async function loadCatalog(cab: CabOrg): Promise<Catalog> {
  const folders = await loadFolders(cab);
  const [audiences, components] = await Promise.all([loadAudiences(cab, folders), loadComponents(cab)]);
  const byId = new Map(audiences.map((a) => [a.id, a]));
  const selectables = new Map<string, Selectable>(
    audiences.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        apiName: a.apiName,
        folderPath: a.folderPath,
        componentIds: (components.get(a.id) ?? []).map((c) => str(c.Audience__c) ?? '').filter(Boolean),
      },
    ])
  );
  return { folders, audiences, byId, components, selectables };
}

export type IdLikeValue = { audience: string; apiName: string; field: string; value: string; object: string };

const ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * D11: finds filter values that look like record Ids: 15 or 18 characters, the Id pattern, and a key
 * prefix of an object in the org. A value with several items (comma, semicolon, or new line) is split.
 */
export function findIdLikeValues(
  nodes: FileNode[],
  keyPrefixes: Map<string, string>
): Array<{ field: string; value: string; object: string; filter: string }> {
  const out: Array<{ field: string; value: string; object: string; filter: string }> = [];
  for (const n of nodes) {
    for (const f of n.filters) {
      for (const valueField of ['Value__c', 'ValueLong__c']) {
        const value = f.fields[valueField];
        if (typeof value !== 'string') continue;
        for (const part of value.split(/[,;\n]/).map((p) => p.trim().replace(/^['"]|['"]$/g, ''))) {
          if (!ID_PATTERN.test(part)) continue;
          const object = keyPrefixes.get(part.slice(0, 3));
          const field = str(f.fields.FilterFieldAPIName__c) ?? valueField;
          // Value__c and ValueLong__c often hold the same value. Report it one time.
          if (object && !out.some((o) => o.field === field && o.value === part && o.filter === f.ref))
            out.push({ field, value: part, object, filter: f.ref });
        }
      }
    }
  }
  return out;
}

/** The latest version of each outcome definition: the snapshot that the import needs to create it. */
async function loadLatestOutcomeVersions(cab: CabOrg, outcomeIds: string[]): Promise<Map<string, Raw>> {
  const info = cab.schema.objects.get('OutcomeDefinitionVersion__c');
  if (!info || !outcomeIds.length) return new Map();
  const versions = await queryIn(
    cab,
    'OutcomeDefinitionVersion__c',
    selectFields(info),
    'OutcomeDefinition__c',
    outcomeIds
  );
  const latest = new Map<string, Raw>();
  for (const v of versions) {
    const id = str(v.OutcomeDefinition__c);
    if (!id) continue;
    const current = latest.get(id);
    if (!current || Number(v.VersionNumber__c ?? 0) > Number(current.VersionNumber__c ?? 0)) latest.set(id, v);
  }
  return latest;
}

function templateKeyOf(raw: Raw): { key: string; name: string } {
  const name = str(raw.Label__c) ?? raw.Id;
  return { key: str(raw.UniqueName__c) ?? name, name };
}

/** Gives each record a key that is unique in the file. A second record with the same key gets " (2)". */
function uniqueKeys(
  records: Raw[],
  keyOf: (r: Raw) => { key: string; name: string }
): Map<string, { key: string; name: string }> {
  const used = new Map<string, number>();
  const out = new Map<string, { key: string; name: string }>();
  for (const r of [...records].sort((a, b) => a.Id.localeCompare(b.Id))) {
    const k = keyOf(r);
    const n = (used.get(k.key.toLowerCase()) ?? 0) + 1;
    used.set(k.key.toLowerCase(), n);
    out.set(r.Id, n === 1 ? k : { key: `${k.key} (${n})`, name: k.name });
  }
  return out;
}

export type ExportBuild = {
  file: ExportFile;
  idLikeValues: IdLikeValue[];
  duplicateKeys: string[];
};

/** Builds the export file for the given audience Ids. Every query is a bulk query (3.1). */
export async function buildExport(
  cab: CabOrg,
  catalog: Catalog,
  ids: string[],
  pluginVersion: string,
  now: Date
): Promise<ExportBuild> {
  const headers = ids.map((id) => catalog.byId.get(id)!).filter((h) => h?.apiName);
  const versionIds = headers.map((h) => h.versionId).filter((v): v is string => Boolean(v));
  const [versions, trees] = await Promise.all([loadVersions(cab, versionIds), loadTrees(cab, { versionIds })]);

  // 3.5: the templates and outcome definitions that the audiences use, one time each.
  const templateIds = new Set<string>();
  const outcomeIds = new Set<string>();
  const collect = (tree: RawTree): void => {
    for (const r of tree.templateReferences) if (str(r.FilterTemplate__c)) templateIds.add(str(r.FilterTemplate__c)!);
    for (const n of tree.nodes) if (str(n.OutcomeDefinition__c)) outcomeIds.add(str(n.OutcomeDefinition__c)!);
  };
  trees.forEach(collect);

  const outcomeInfo = cab.schema.objects.get('OutcomeDefinition__c');
  const outcomes =
    outcomeInfo && outcomeIds.size
      ? await queryIn(
          cab,
          'OutcomeDefinition__c',
          selectFields(outcomeInfo, outcomeInfo.fields.has('UniqueName__c') ? ['UniqueName__c'] : []),
          'Id',
          [...outcomeIds]
        )
      : [];
  const outcomeRootIds = outcomes.map((o) => str(o.OutcomeTemplateRoot__c)).filter((v): v is string => Boolean(v));
  const libraryTrees = await loadTrees(cab, { rootIds: [...templateIds, ...outcomeRootIds] });
  // A template can use an outcome definition. Its outcome is not loaded again here; the import warns if it is missing.
  libraryTrees.forEach(collect);

  const templateRoots = [...libraryTrees.values()]
    .map((t) => t.nodes.find((n) => templateIds.has(n.Id)))
    .filter((n): n is Raw => Boolean(n));
  const templateKeys = uniqueKeys(templateRoots, templateKeyOf);
  const outcomeKeys = uniqueKeys(outcomes, (o) => {
    const name = str(o.Name) ?? o.Id;
    return { key: str(o.UniqueName__c) ?? name, name };
  });
  const keys: KeyResolver = {
    template: (id) => templateKeys.get(id)?.key ?? null,
    outcome: (id) => outcomeKeys.get(id)?.key ?? null,
  };
  const duplicateKeys = [...templateKeys.values(), ...outcomeKeys.values()]
    .filter((k) => / \(\d+\)$/.test(k.key))
    .map((k) => k.name);

  const apiNameOf = (id: string): string => catalog.byId.get(id)?.apiName ?? '';
  const audiences = headers.map((h) =>
    convertAudience(
      cab.schema,
      {
        audience: h.raw,
        apiName: h.apiName!,
        folderPath: h.folderPath,
        version: h.versionId ? versions.get(h.versionId) : undefined,
        components: (catalog.components.get(h.id) ?? []).map((raw) => ({
          raw,
          audienceApiName: apiNameOf(str(raw.Audience__c) ?? ''),
        })),
        tree: h.versionId ? trees.get(h.versionId) : undefined,
      },
      keys
    )
  );

  const templates: FileTemplate[] = templateRoots.map((root) => ({
    key: templateKeys.get(root.Id)!.key,
    name: templateKeys.get(root.Id)!.name,
    tree: convertTree(cab.schema, libraryTrees.get(root.Id)!, keys),
  }));
  const latestVersions = await loadLatestOutcomeVersions(
    cab,
    outcomes.map((o) => o.Id)
  );
  const outcomeDefinitions: FileOutcome[] = outcomes.map((o) => {
    const root = str(o.OutcomeTemplateRoot__c);
    const tree = root ? libraryTrees.get(root) : undefined;
    const version = latestVersions.get(o.Id);
    return {
      key: outcomeKeys.get(o.Id)!.key,
      name: outcomeKeys.get(o.Id)!.name,
      ...toFileRecord(cab.schema, 'OutcomeDefinition__c', o),
      tree: tree ? convertTree(cab.schema, tree, keys) : [],
      version: version ? toFileRecord(cab.schema, 'OutcomeDefinitionVersion__c', version) : null,
    };
  });

  // The folders of the audiences and all their parent folders.
  const folderIds = new Set<string>();
  for (const h of headers) {
    let id = h.folderId;
    while (id && !folderIds.has(id)) {
      folderIds.add(id);
      id = catalog.folders.get(id)?.parentId ?? null;
    }
  }
  const folders: FileFolder[] = [...folderIds]
    .map((id) => catalog.folders.get(id)!)
    .filter(Boolean)
    .map((f) => ({
      uniqueName: f.uniqueName,
      label: f.uniqueName,
      parent: f.parentId ? catalog.folders.get(f.parentId)?.uniqueName ?? null : null,
      path: f.path,
    }));

  const idLikeValues: IdLikeValue[] = [];
  for (const a of audiences) {
    for (const v of findIdLikeValues(a.tree, cab.keyPrefixes)) {
      idLikeValues.push({ audience: str(a.fields.Name) ?? a.apiName, apiName: a.apiName, ...v });
    }
  }

  const byKey =
    <T>(key: (x: T) => string) =>
    (a: T, b: T): number =>
      key(a).toLowerCase().localeCompare(key(b).toLowerCase());
  const file: ExportFile = {
    format: FORMAT,
    exportedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    plugin: `sf-plugin-cab ${pluginVersion}`,
    source: {
      org: cab.orgName,
      orgId: cab.orgId,
      isSandbox: cab.isSandbox && !cab.isScratch,
      cabVersion: cab.cabVersion,
    },
    folders: folders.sort(byKey((f) => f.path)),
    templates: templates.sort(byKey((t) => t.key)),
    outcomeDefinitions: outcomeDefinitions.sort(byKey((o) => o.key)),
    audiences: audiences.sort(byKey((a) => a.apiName)),
  };
  return { file, idLikeValues, duplicateKeys };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "20261014-1405" in local time. */
export function timestamp(now: Date): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}`;
}

export function safeAlias(alias: string): string {
  return alias.replace(/[^A-Za-z0-9_.@-]/g, '_');
}

/** `cab-audiences-<org alias>-<YYYYMMDD-HHmm>.json` in the current directory. */
export function defaultExportPath(alias: string, now: Date): string {
  return resolve(`cab-audiences-${safeAlias(alias)}-${timestamp(now)}.json`);
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

/** 3.8: writes the file with sorted keys and two-space indentation. */
export async function writeExportFile(path: string, file: ExportFile): Promise<void> {
  await writeFile(path, stableStringify(file), 'utf8');
}
