import { Messages } from '@salesforce/core';
import { loadExistingClasses, loadTargetFields, treeProblems, usedClasses, usedFields } from './checks.js';
import { convertTree, KeyResolver } from './convert.js';
import { buildExport, Catalog, findIdLikeValues, loadCatalog } from './exporter.js';
import type { DefaultAnswer, MissingAnswer } from './flags.js';
import { sha256 } from './json.js';
import { LibraryMatch, matchLibrary } from './library.js';
import type {
  ExportFile,
  FileAudience,
  FileFolder,
  FileNode,
  FileOutcome,
  FileTemplate,
  FileTemplateReference,
} from './model.js';
import { FieldFilter, fileFieldNames, hashAudience, projectTree } from './normalize.js';
import type { CabOrg } from './org.js';
import {
  AudienceHeader,
  loadOutcomeDefinitions,
  loadRunningVersions,
  loadTemplateRoots,
  loadTrees,
  Raw,
  RawTree,
  str,
} from './read.js';
import { definitionFields, DEFINITION_OBJECTS } from './schema.js';
import { audienceLabel } from './ux.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'plan');

/** Composite Graph allows 500 nodes in one graph. */
export const MAX_GRAPH_NODES = 500;

export type Answers = {
  folders: MissingAnswer;
  templates: MissingAnswer;
  outcomes: MissingAnswer;
  /** For a created template that is a default in the source: keep the default setting, or clear it. */
  templateDefaults: DefaultAnswer;
};

export type Action = 'create' | 'update' | 'unchanged' | 'blocked';

export type LibraryItem<T> = {
  entry: T;
  match: LibraryMatch;
  /** True if the target record differs from the file. The import never changes it (D12). */
  differs: boolean;
  /** Target audiences that use the record and are not in the file. */
  otherUses: number;
  /** Why the import cannot create this record, or undefined. */
  cannotCreate?: string;
};

export type AudiencePlan = {
  entry: FileAudience;
  name: string;
  label: string;
  action: Action;
  target?: AudienceHeader;
  /** The target definition in file form, for the backup. */
  targetEntry?: FileAudience;
  /** Problems that do not depend on the answers. */
  fixedBlockers: string[];
  blockers: string[];
  warnings: string[];
  /** API names of the components that are in the file. */
  fileDependencies: string[];
  removedComponents: number;
  nodeCount: number;
  large: boolean;
  hashEqual: boolean;
};

export type Plan = {
  target: CabOrg;
  file: ExportFile;
  catalog: Catalog;
  audiences: AudiencePlan[];
  targetOnly: number;
  /** Folders that the file has and the target does not, parents first. */
  missingFolders: FileFolder[];
  /** Target folder Id by lower-case unique name. */
  folderIds: Map<string, string>;
  templates: Map<string, LibraryItem<FileTemplate>>;
  outcomes: Map<string, LibraryItem<FileOutcome>>;
  /** True if the user can create Synced template references in the target. */
  canCreateTemplateReferences: boolean;
  schemaWarnings: string[];
  libraryWarnings: string[];
  /** The current target definitions of the matched audiences, in the export format. The backup uses it. */
  targetFile?: ExportFile;
  /** The filter object Ids of each target version tree. The graphs delete them. */
  oldTrees: Map<string, string[]>;
  /** Filter values that look like record Ids (D11). */
  idLikeValues: Array<{ audience: string; field: string; value: string; object: string }>;
  answers: Answers;
};

type Context = {
  target: CabOrg;
  allowed: FieldFilter;
};

function nodeLabel(entry: FileAudience): string {
  return audienceLabel(str(entry.fields.Name) ?? entry.apiName, entry.apiName);
}

/** 4.7: the number of graph nodes that one audience needs (D8). */
export function countGraphNodes(
  entry: FileAudience,
  opts: { update: boolean; oldTreeSize: number; oldComponents: number; templateReferences: number }
): number {
  let count = opts.update ? 2 : 3; // audience, version, and for a create the LatestVersion__c link
  count += entry.components.length + Math.max(0, opts.oldComponents - entry.components.length);
  if (opts.update) count += opts.oldTreeSize;
  const index = new Map(entry.tree.map((n, i) => [n.ref, i]));
  for (const [i, n] of entry.tree.entries()) {
    count += 1 + n.filters.length + n.dataInclusions.length;
    for (const d of n.dataInclusions) count += d.sorts.length;
    // A link to a later node needs an update after the insert.
    if (n.aggregateChainStart && (index.get(n.aggregateChainStart) ?? 0) > i) count += 1;
  }
  return count + opts.templateReferences;
}

/** The allowed fields: in the file, in the target, and writable there (D5). */
function allowedFields(target: CabOrg, file: ExportFile): FieldFilter {
  const inFile = fileFieldNames([...file.audiences, ...templatesAsAudiences(file)]);
  const cache = new Map<string, Set<string> | undefined>();
  return (objectName: string) => {
    if (!cache.has(objectName)) {
      const info = target.schema.objects.get(objectName);
      const names = inFile.get(objectName);
      cache.set(
        objectName,
        info && names
          ? new Set(
              definitionFields(info)
                .map((f) => f.name)
                .filter((f) => names.has(f))
            )
          : undefined
      );
    }
    return cache.get(objectName);
  };
}

function templatesAsAudiences(file: ExportFile): FileAudience[] {
  return [...file.templates, ...file.outcomeDefinitions].map((t) => ({
    apiName: t.key,
    folder: null,
    fields: {},
    version: { fields: {} },
    components: [],
    tree: t.tree,
  }));
}

/** 4.10 / spec "Schema differences": one warning for each missing object and each missing field. */
function schemaWarnings(target: CabOrg, file: ExportFile, ctx: Context): string[] {
  const out: string[] = [];
  const inFile = fileFieldNames([...file.audiences, ...templatesAsAudiences(file)]);
  const recordsByObject = recordCounts(file);
  for (const objectName of DEFINITION_OBJECTS) {
    const names = inFile.get(objectName);
    const count = recordsByObject.get(objectName) ?? 0;
    if (!count) continue;
    const info = target.schema.objects.get(objectName);
    if (!info) {
      out.push(messages.getMessage('warn.objectMissing', [count, objectLabel(objectName), target.orgName]));
      continue;
    }
    const allowed = ctx.allowed(objectName) ?? new Set<string>();
    for (const field of [...(names ?? [])].sort()) {
      if (allowed.has(field)) continue;
      const exists = info.fields.has(field);
      out.push(
        messages.getMessage(exists ? 'warn.fieldReadOnly' : 'warn.fieldMissing', [
          `${objectName}.${field}`,
          target.orgName,
        ])
      );
    }
  }
  return out;
}

function objectLabel(objectName: string): string {
  const labels: Record<string, string> = {
    AudienceFilterTemplateReference__c: 'template references',
    IntermediateSortConfiguration__c: 'sort configurations',
    AudienceDataInclusion__c: 'data inclusions',
    QueryFilter__c: 'filters',
    AudienceFilterObject__c: 'filter objects',
    AudienceSequenceComponent__c: 'sequence components',
  };
  return labels[objectName] ?? `${objectName} records`;
}

function recordCounts(file: ExportFile): Map<string, number> {
  const out = new Map<string, number>();
  const add = (o: string, n: number): void => {
    out.set(o, (out.get(o) ?? 0) + n);
  };
  const addTree = (tree: FileNode[]): void => {
    for (const n of tree) {
      add('AudienceFilterObject__c', 1);
      add('QueryFilter__c', n.filters.length);
      add('AudienceDataInclusion__c', n.dataInclusions.length);
      add(
        'IntermediateSortConfiguration__c',
        n.dataInclusions.reduce((s, d) => s + d.sorts.length, 0)
      );
      add('AudienceFilterTemplateReference__c', n.templateReferences.length);
    }
  };
  for (const a of file.audiences) {
    add('Audience__c', 1);
    add('AudienceVersion__c', 1);
    add('AudienceSequenceComponent__c', a.components.length);
    addTree(a.tree);
  }
  for (const t of [...file.templates, ...file.outcomeDefinitions]) addTree(t.tree);
  return out;
}

/** Counts the target audiences outside the file that use each template or outcome definition. */
async function libraryUses(
  target: CabOrg,
  templateIds: string[],
  outcomeIds: string[],
  excludeAudiences: Set<string>
): Promise<Map<string, number>> {
  const uses = new Map<string, Set<string>>();
  const ns = target.schema.ns;
  const run = async (soql: string, keyField: string, audiencePath: string[]): Promise<void> => {
    const result = await target.conn.autoFetchQuery(soql, { maxFetch: 1_000_000 });
    for (const r of result.records as Array<Record<string, unknown>>) {
      let value: unknown = r;
      for (const p of audiencePath) value = (value as Record<string, unknown> | null)?.[p];
      const key = r[keyField] as string;
      if (typeof value !== 'string' || excludeAudiences.has(value)) continue;
      uses.set(key, (uses.get(key) ?? new Set()).add(value));
    }
  };
  const inList = (ids: string[]): string => ids.map((i) => `'${i}'`).join(', ');
  if (templateIds.length && target.schema.objects.has('AudienceFilterTemplateReference__c')) {
    await run(
      `SELECT ${ns}FilterTemplate__c, ${ns}AudienceFilterObject__r.${ns}AudienceVersion__r.${ns}Audience__c ` +
        `FROM ${ns}AudienceFilterTemplateReference__c WHERE ${ns}FilterTemplate__c IN (${inList(templateIds)})`,
      `${ns}FilterTemplate__c`,
      [`${ns}AudienceFilterObject__r`, `${ns}AudienceVersion__r`, `${ns}Audience__c`]
    );
  }
  if (outcomeIds.length) {
    await run(
      `SELECT ${ns}OutcomeDefinition__c, ${ns}AudienceVersion__r.${ns}Audience__c FROM ${ns}AudienceFilterObject__c ` +
        `WHERE ${ns}OutcomeDefinition__c IN (${inList(outcomeIds)})`,
      `${ns}OutcomeDefinition__c`,
      [`${ns}AudienceVersion__r`, `${ns}Audience__c`]
    );
  }
  return new Map([...uses].map(([k, v]) => [k, v.size]));
}

function treeHash(nodes: FileNode[], allowed: FieldFilter): string {
  return sha256(projectTree(nodes, allowed, () => true));
}

/** Why a template cannot be created through the API, or undefined. */
function templateCreateProblem(target: CabOrg, entry: FileTemplate): string | undefined {
  const afo = target.schema.objects.get('AudienceFilterObject__c');
  if (!afo?.fields.get('IsTemplate__c')?.createable)
    return messages.getMessage('cannot.templatePermission', [target.orgName]);
  // The CAB trigger refuses aggregate Filter Library topology outside its own Apex service.
  if (entry.tree.some((n) => n.fields.IsAggregate__c === true || n.aggregateChainStart))
    return messages.getMessage('cannot.templateAggregate');
  return undefined;
}

const SF_ID_IN_JSON = /"([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})"/g;

/**
 * Why an outcome definition cannot be created through the API, or undefined. Spike 4.9 showed that a
 * definition, its version snapshot, and its condition tree made through REST work in CAB.
 */
export function outcomeCreateProblem(target: CabOrg, entry: FileOutcome): string | undefined {
  const od = target.schema.objects.get('OutcomeDefinition__c');
  const odv = target.schema.objects.get('OutcomeDefinitionVersion__c');
  if (!od || !odv) return messages.getMessage('cannot.outcomeObject', [target.orgName]);
  const afo = target.schema.objects.get('AudienceFilterObject__c');
  if (!od.createable || !odv.createable || !afo?.fields.get('IsOutcomeTemplate__c')?.createable) {
    return messages.getMessage('cannot.outcomePermission', [target.orgName]);
  }
  if (!entry.version) return messages.getMessage('cannot.outcomeNoVersion');
  // The version snapshot must not point to records of the source org.
  const config =
    typeof entry.version.fields.RootConfigJson__c === 'string' ? entry.version.fields.RootConfigJson__c : '';
  for (const m of config.matchAll(SF_ID_IN_JSON)) {
    if (/\d/.test(m[1]) && target.keyPrefixes.has(m[1].slice(0, 3))) return messages.getMessage('cannot.outcomeIds');
  }
  return undefined;
}

async function planLibrary(
  target: CabOrg,
  file: ExportFile,
  ctx: Context,
  matchedAudienceIds: Set<string>
): Promise<{
  templates: Map<string, LibraryItem<FileTemplate>>;
  outcomes: Map<string, LibraryItem<FileOutcome>>;
  reverse: KeyResolver;
}> {
  const afo = target.schema.objects.get('AudienceFilterObject__c');
  const od = target.schema.objects.get('OutcomeDefinition__c');
  const [templateRoots, outcomeRecords] = await Promise.all([
    file.templates.length ? loadTemplateRoots(target) : Promise.resolve([] as Raw[]),
    file.outcomeDefinitions.length ? loadOutcomeDefinitions(target) : Promise.resolve([] as Raw[]),
  ]);
  const templates = new Map<string, LibraryItem<FileTemplate>>();
  const outcomes = new Map<string, LibraryItem<FileOutcome>>();
  const templateIdToKey = new Map<string, string>();
  const outcomeIdToKey = new Map<string, string>();
  for (const t of file.templates) {
    const match = matchLibrary(t, templateRoots, 'Label__c', Boolean(afo?.fields.has('UniqueName__c')));
    if (match.status === 'matched') templateIdToKey.set(match.targetId, t.key);
    templates.set(t.key, {
      entry: t,
      match,
      differs: false,
      otherUses: 0,
      cannotCreate: match.status === 'matched' ? undefined : templateCreateProblem(target, t),
    });
  }
  for (const o of file.outcomeDefinitions) {
    const match = matchLibrary(o, outcomeRecords, 'Name', Boolean(od?.fields.has('UniqueName__c')));
    if (match.status === 'matched') outcomeIdToKey.set(match.targetId, o.key);
    const cannotCreate = outcomeCreateProblem(target, o);
    outcomes.set(o.key, {
      entry: o,
      match,
      differs: false,
      otherUses: 0,
      cannotCreate: match.status === 'matched' ? undefined : cannotCreate,
    });
  }
  const reverse: KeyResolver = {
    template: (id) => templateIdToKey.get(id) ?? null,
    outcome: (id) => outcomeIdToKey.get(id) ?? null,
  };

  // Compare the matched records with the file. Never change them (D12).
  const outcomeRoots = new Map(outcomeRecords.map((o) => [o.Id, str(o.OutcomeTemplateRoot__c)]));
  const rootIds = [
    ...templateIdToKey.keys(),
    ...[...outcomeIdToKey.keys()].map((id) => outcomeRoots.get(id)).filter((v): v is string => Boolean(v)),
  ];
  const trees: Map<string, RawTree> = rootIds.length
    ? await loadTrees(target, { rootIds })
    : new Map<string, RawTree>();
  for (const item of templates.values()) {
    if (item.match.status !== 'matched') continue;
    const tree = trees.get(item.match.targetId);
    item.differs =
      !tree ||
      treeHash(convertTree(target.schema, tree, reverse), ctx.allowed) !== treeHash(item.entry.tree, ctx.allowed);
  }
  for (const item of outcomes.values()) {
    if (item.match.status !== 'matched') continue;
    const root = outcomeRoots.get(item.match.targetId);
    const tree = root ? trees.get(root) : undefined;
    const record = outcomeRecords.find((o) => o.Id === (item.match as { targetId: string }).targetId)!;
    const fieldsDiffer = Object.entries(item.entry.fields).some(
      ([k, v]) =>
        (ctx.allowed('OutcomeDefinition__c')?.has(k) ?? true) && od?.fields.has(k) && (record[k] ?? null) !== v
    );
    item.differs =
      fieldsDiffer ||
      (tree
        ? treeHash(convertTree(target.schema, tree, reverse), ctx.allowed) !== treeHash(item.entry.tree, ctx.allowed)
        : item.entry.tree.length > 0);
  }
  const uses = await libraryUses(target, [...templateIdToKey.keys()], [...outcomeIdToKey.keys()], matchedAudienceIds);
  for (const [id, key] of templateIdToKey) templates.get(key)!.otherUses = uses.get(id) ?? 0;
  for (const [id, key] of outcomeIdToKey) outcomes.get(key)!.otherUses = uses.get(id) ?? 0;
  return { templates, outcomes, reverse };
}

/** 4.2 to 4.8: collects every fact about the import that does not depend on the answers. */
export async function buildPlan(
  target: CabOrg,
  file: ExportFile,
  answers: Answers,
  pluginVersion: string
): Promise<Plan> {
  const catalog = await loadCatalog(target);
  const ctx: Context = { target, allowed: allowedFields(target, file) };

  // 4.2: match by API name, with no regard to case.
  const targetByApi = new Map<string, AudienceHeader>();
  for (const a of catalog.audiences) if (a.apiName) targetByApi.set(a.apiName.toLowerCase(), a);
  const fileApi = new Set(file.audiences.map((a) => a.apiName.toLowerCase()));
  const matched = file.audiences
    .map((a) => targetByApi.get(a.apiName.toLowerCase()))
    .filter((h): h is AudienceHeader => Boolean(h));
  const matchedIds = new Set(matched.map((h) => h.id));
  const targetOnly = catalog.audiences.filter((a) => !a.apiName || !fileApi.has(a.apiName.toLowerCase())).length;

  // The current target definitions, in file form: for the comparison (4.3) and for the backup.
  const targetBuild = matched.length
    ? await buildExport(target, catalog, [...matchedIds], pluginVersion, new Date())
    : undefined;
  const targetEntries = new Map((targetBuild?.file.audiences ?? []).map((a) => [a.apiName.toLowerCase(), a]));

  // Folders: by unique name. A folder with the same unique name is used as it is.
  const folderIds = new Map([...catalog.folders.values()].map((f) => [f.uniqueName.toLowerCase(), f.id]));
  const neededPaths = new Set(file.audiences.map((a) => a.folder).filter((p): p is string => Boolean(p)));
  const needed = file.folders.filter((f) => [...neededPaths].some((p) => p === f.path || p.startsWith(f.path + '/')));
  const missingFolders = needed
    .filter((f) => !folderIds.has(f.uniqueName.toLowerCase()))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));

  const library = await planLibrary(target, file, ctx, matchedIds);
  const aftr = target.schema.objects.get('AudienceFilterTemplateReference__c');
  const canCreateTemplateReferences = Boolean(aftr?.createable);

  // 4.5: the target schema for the objects and fields that the filters use, and the custom filter classes.
  const allTrees = file.audiences.map((a) => a.tree);
  const objects = [...new Set(allTrees.flatMap((t) => [...usedFields(t).keys()]))];
  const [targetFields, classes, running] = await Promise.all([
    loadTargetFields(target, objects),
    loadExistingClasses(target, allTrees.flatMap(usedClasses)),
    loadRunningVersions(
      target,
      matched.map((h) => h.versionId).filter((v): v is string => Boolean(v))
    ),
  ]);
  const oldTrees = await loadOldTrees(target, matched);

  const audiences = file.audiences.map((entry): AudiencePlan => {
    const header = targetByApi.get(entry.apiName.toLowerCase());
    const fixedBlockers: string[] = [];
    for (const p of treeProblems(entry.tree, target.objectNames, targetFields, classes, target.schema.ns)) {
      if (p.kind === 'object') fixedBlockers.push(messages.getMessage('block.object', [p.object, target.orgName]));
      else if (p.kind === 'field')
        fixedBlockers.push(messages.getMessage('block.field', [`${p.object}.${p.field}`, target.orgName]));
      else fixedBlockers.push(messages.getMessage('block.class', [p.className, target.orgName]));
    }
    if (header?.versionId && running.has(header.versionId)) fixedBlockers.push(messages.getMessage('block.running'));
    const fileDependencies: string[] = [];
    for (const c of entry.components) {
      if (fileApi.has(c.audience.toLowerCase())) fileDependencies.push(c.audience);
      else if (!targetByApi.has(c.audience.toLowerCase()))
        fixedBlockers.push(messages.getMessage('block.componentMissing', [c.audience, target.orgName]));
    }
    const oldComponents = header ? (catalog.components.get(header.id) ?? []).length : 0;
    const templateReferences = entry.tree.reduce((s, n) => s + n.templateReferences.length, 0);
    const nodeCount = countGraphNodes(entry, {
      update: Boolean(header),
      oldTreeSize: header?.versionId ? oldTrees.get(header.versionId)?.length ?? 0 : 0,
      oldComponents,
      templateReferences,
    });
    return {
      entry,
      name: str(entry.fields.Name) ?? entry.apiName,
      label: nodeLabel(entry),
      action: header ? 'update' : 'create',
      target: header,
      targetEntry: targetEntries.get(entry.apiName.toLowerCase()),
      fixedBlockers,
      blockers: [],
      warnings: [],
      fileDependencies,
      removedComponents: Math.max(0, oldComponents - entry.components.length),
      nodeCount,
      large: nodeCount > MAX_GRAPH_NODES,
      hashEqual: false,
    };
  });

  const libraryWarnings: string[] = [];
  for (const item of library.templates.values()) {
    if (item.match.status === 'ambiguous')
      libraryWarnings.push(
        messages.getMessage('warn.ambiguousTemplate', [item.entry.name, target.orgName, item.match.names.length])
      );
    if (item.differs)
      libraryWarnings.push(
        messages.getMessage('warn.templateDiffers', [item.entry.name, target.orgName, item.otherUses, target.orgName])
      );
  }
  for (const item of library.outcomes.values()) {
    if (item.match.status === 'ambiguous')
      libraryWarnings.push(
        messages.getMessage('warn.ambiguousOutcome', [item.entry.name, target.orgName, item.match.names.length])
      );
    if (item.differs)
      libraryWarnings.push(
        messages.getMessage('warn.outcomeDiffers', [item.entry.name, target.orgName, item.otherUses, target.orgName])
      );
  }

  const plan: Plan = {
    target,
    file,
    catalog,
    audiences: orderAudiences(audiences),
    targetOnly,
    missingFolders,
    folderIds,
    templates: library.templates,
    outcomes: library.outcomes,
    canCreateTemplateReferences,
    targetFile: targetBuild?.file,
    oldTrees,
    schemaWarnings: schemaWarnings(target, file, ctx),
    libraryWarnings,
    idLikeValues: file.audiences.flatMap((a) =>
      findIdLikeValues(a.tree, target.keyPrefixes).map((v) => ({ audience: nodeLabel(a), ...v }))
    ),
    answers,
  };
  evaluatePlan(plan, answers, ctx.allowed);
  return plan;
}

/** The filter object Ids of each target version tree. */
async function loadOldTrees(target: CabOrg, matched: AudienceHeader[]): Promise<Map<string, string[]>> {
  const versionIds = matched.map((h) => h.versionId).filter((v): v is string => Boolean(v));
  if (!versionIds.length) return new Map();
  const trees = await loadTrees(target, { versionIds });
  return new Map([...trees].filter(([id]) => versionIds.includes(id)).map(([id, t]) => [id, t.nodes.map((n) => n.Id)]));
}

/** 4.6: components before the sequences that use them. A cycle keeps the file order. */
export function orderAudiences(audiences: AudiencePlan[]): AudiencePlan[] {
  const byApi = new Map(audiences.map((a) => [a.entry.apiName.toLowerCase(), a]));
  const out: AudiencePlan[] = [];
  const state = new Map<AudiencePlan, 'visiting' | 'done'>();
  const visit = (a: AudiencePlan): void => {
    if (state.get(a)) return;
    state.set(a, 'visiting');
    for (const dep of a.fileDependencies) {
      const d = byApi.get(dep.toLowerCase());
      if (d && !state.get(d)) visit(d);
    }
    state.set(a, 'done');
    out.push(a);
  };
  audiences.forEach(visit);
  return out;
}

/** True if the import writes this template reference: a Synced reference to a template that exists or is created. */
export function writesTemplateReference(
  plan: Pick<Plan, 'canCreateTemplateReferences' | 'templates'>,
  ref: FileTemplateReference,
  answers: Answers
): boolean {
  if (!plan.canCreateTemplateReferences || ref.fields.ReferenceMode__c === 'Locked') return false;
  const item = plan.templates.get(ref.template);
  if (!item) return false;
  return item.match.status === 'matched' || (answers.templates === 'create' && !item.cannotCreate);
}

function addOnce(list: string[], message: string | undefined): void {
  if (message && !list.includes(message)) list.push(message);
}

/** The message for a template reference that the import does not write, or undefined. */
function templateRefMessage(plan: Plan, r: FileTemplateReference): string | undefined {
  const target = plan.target;
  // One schema warning covers a target without template references.
  if (!target.schema.objects.has('AudienceFilterTemplateReference__c')) return undefined;
  const name = plan.templates.get(r.template)?.entry.name ?? r.template;
  if (r.fields.ReferenceMode__c === 'Locked' || !plan.canCreateTemplateReferences) {
    const mode = typeof r.fields.ReferenceMode__c === 'string' ? r.fields.ReferenceMode__c : 'Synced';
    return messages.getMessage('warn.liveLinkNotCreated', [name, mode, target.orgName, target.orgName]);
  }
  return messages.getMessage('warn.notLinked', [name]);
}

/** The blockers and warnings that come from the filter tree of one audience. */
function treeFindings(plan: Plan, nodes: FileNode[], answers: Answers, blockers: string[], warnings: string[]): void {
  for (const n of nodes) {
    if (n.outcome) {
      const item = plan.outcomes.get(n.outcome);
      const exists = item?.match.status === 'matched';
      const created = item && answers.outcomes === 'create' && !item.cannotCreate;
      if (!exists && !created)
        addOnce(blockers, messages.getMessage('block.outcome', [item?.entry.name ?? n.outcome, plan.target.orgName]));
    }
    for (const r of n.templateReferences) {
      if (!writesTemplateReference(plan, r, answers)) addOnce(warnings, templateRefMessage(plan, r));
    }
    for (const link of [...(n.clearedLinks ?? []), ...n.dataInclusions.flatMap((d) => d.clearedLinks ?? [])]) {
      addOnce(warnings, messages.getMessage('warn.clearedLink', [link]));
    }
  }
}

/**
 * Sets the action, the blockers, and the warnings of each audience for the given answers. Run it again
 * when the answers change.
 */
export function evaluatePlan(plan: Plan, answers: Answers, allowed?: FieldFilter): void {
  plan.answers = answers;
  const filter = allowed ?? allowedFields(plan.target, plan.file);
  const folderKnown = (path: string | null): boolean => {
    if (!path) return true;
    const unique = plan.file.folders.find((f) => f.path === path)?.uniqueName ?? path.split('/').pop()!;
    return plan.folderIds.has(unique.toLowerCase());
  };
  const keepRef = (r: FileTemplateReference): boolean => writesTemplateReference(plan, r, answers);

  for (const a of plan.audiences) {
    const blockers = [...a.fixedBlockers];
    const warnings: string[] = [];
    treeFindings(plan, a.entry.tree, answers, blockers, warnings);
    for (const link of [...(a.entry.clearedLinks ?? []), ...(a.entry.version.clearedLinks ?? [])])
      addOnce(warnings, messages.getMessage('warn.clearedLink', [link]));
    const writesFolder = folderKnown(a.entry.folder) || answers.folders === 'create';
    if (a.entry.folder && !writesFolder) warnings.push(messages.getMessage('warn.noFolder', [a.entry.folder]));
    if (a.removedComponents) warnings.push(messages.getMessage('warn.removedComponents', [a.removedComponents]));
    if (a.large) warnings.push(messages.getMessage('warn.large', [a.nodeCount]));

    a.hashEqual =
      a.targetEntry !== undefined &&
      hashAudience(a.entry, { allowed: filter, keepRef, compareFolder: writesFolder }) ===
        hashAudience(a.targetEntry, { allowed: filter, keepRef: () => true, compareFolder: writesFolder });
    a.blockers = blockers;
    a.warnings = warnings;
    a.action = a.hashEqual ? 'unchanged' : blockers.length ? 'blocked' : a.target ? 'update' : 'create';
  }

  // 4.6: a sequence is blocked if a component in the file is blocked. The audiences are in import order.
  const byApi = new Map(plan.audiences.map((a) => [a.entry.apiName.toLowerCase(), a]));
  for (const a of plan.audiences) {
    if (a.action === 'unchanged' || a.action === 'blocked') continue;
    const blocked = a.fileDependencies.map((d) => byApi.get(d.toLowerCase())).find((d) => d?.action === 'blocked');
    if (blocked) {
      a.blockers.push(messages.getMessage('block.componentBlocked', [blocked.label]));
      a.action = 'blocked';
    }
  }
}

export function counts(plan: Plan): Record<Action, number> {
  const c: Record<Action, number> = { create: 0, update: 0, unchanged: 0, blocked: 0 };
  for (const a of plan.audiences) c[a.action]++;
  return c;
}
