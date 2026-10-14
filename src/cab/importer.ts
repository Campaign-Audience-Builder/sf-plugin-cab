import { Messages } from '@salesforce/core';
import { NodeError, runNodes } from './composite.js';
import { addTree, GraphBuilder, GraphPlan, NodeInfo, ref } from './graph.js';
import type { FileFolder } from './model.js';
import type { CabOrg } from './org.js';
import { AudiencePlan, evaluatePlan, Plan, writesTemplateReference } from './plan.js';
import { addNs } from './schema.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'importer');

export type Status = 'created' | 'updated' | 'unchanged' | 'blocked' | 'failed' | 'skipped' | 'notProcessed';

export type AudienceResult = {
  name: string;
  apiName: string;
  status: Status;
  reason?: string;
  targetId?: string;
  /** The action of the plan. Set in a dry run. */
  planned?: 'create' | 'update' | 'unchanged' | 'blocked';
  /** True if the audience was written in several requests (large: not atomic). */
  notAtomic?: boolean;
};

export type LibraryResult = {
  kind: 'folder' | 'template' | 'outcome';
  name: string;
  status: 'created' | 'failed';
  reason?: string;
  targetId?: string;
};

export type ImportRun = {
  audiences: AudienceResult[];
  library: LibraryResult[];
  stopped: boolean;
};

export type RunOptions = {
  failFast: boolean;
  verbose: boolean;
  now: Date;
  onProgress(done: number, total: number, label: string): void;
  shouldStop(): boolean;
};

/** 5.8: one message with the audience, the record and field, and the Salesforce text. Ids only with --verbose. */
export function translateError(
  label: string,
  error: NodeError,
  info: Map<string, NodeInfo>,
  ns: string,
  verbose: boolean
): string {
  const node = info.get(error.referenceId);
  const fields = error.fields.map((f) => (ns && f.startsWith(ns) ? f.slice(ns.length) : f));
  const what = node ? node.what.replace(`${label}: `, '') : messages.getMessage('unknownRecord');
  const text = verbose
    ? error.message
    : error.message.replace(/\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g, (m) =>
        /\d/.test(m) && /[a-z]/i.test(m) ? '<Id>' : m
      );
  return messages.getMessage('error.rejected', [
    what,
    fields.length ? ` (${fields.join(', ')})` : '',
    text,
    error.errorCode,
  ]);
}

type RunContext = {
  plan: Plan;
  target: CabOrg;
  apiVersion: string;
  now: string;
  audienceIds: Map<string, string>;
  folderIds: Map<string, string>;
  templateIds: Map<string, string>;
  outcomeIds: Map<string, string>;
};

/** The folder Id for an audience: an Id, null for "no folder", or undefined for "do not change". */
function folderFor(ctx: RunContext, path: string | null, update: boolean): string | null | undefined {
  if (!path) return update ? null : undefined;
  const unique = ctx.plan.file.folders.find((f) => f.path === path)?.uniqueName ?? path.split('/').pop()!;
  const id = ctx.folderIds.get(unique.toLowerCase());
  if (id) return id;
  return update ? undefined : null;
}

/** D8: one graph for one audience: audience, version, components, new tree, and the deletes of the old tree. */
export function buildAudienceGraph(ctx: RunContext, a: AudiencePlan): GraphPlan {
  const g = new GraphBuilder(ctx.target, ctx.apiVersion);
  const entry = a.entry;
  const label = a.label;
  const header = a.target;
  const folder = folderFor(ctx, entry.folder, Boolean(header));
  const folderExtra = folder === undefined ? {} : { AudienceFolder__c: folder };
  let versionRef: string;
  if (header) {
    g.patch(
      'aud',
      'Audience__c',
      header.id,
      g.body('Audience__c', entry.fields, 'update', folderExtra),
      label,
      entry.fields
    );
  } else {
    g.post(
      'aud',
      'Audience__c',
      g.body('Audience__c', entry.fields, 'create', { ...folderExtra, AudienceAPIName__c: entry.apiName }),
      label,
      entry.fields
    );
  }
  if (header?.versionId) {
    g.patch(
      'ver',
      'AudienceVersion__c',
      header.versionId,
      g.body('AudienceVersion__c', entry.version.fields, 'update', { LastConfigurationChange__c: ctx.now }),
      `${label}: version`,
      entry.version.fields
    );
    versionRef = header.versionId;
  } else {
    const audience = header ? header.id : ref('aud');
    g.post(
      'ver',
      'AudienceVersion__c',
      g.body('AudienceVersion__c', entry.version.fields, 'create', {
        Audience__c: audience,
        LastConfigurationChange__c: ctx.now,
      }),
      `${label}: version`,
      entry.version.fields
    );
    g.patch('audv', 'Audience__c', audience, { [addNs('LatestVersion__c', ctx.target.schema.ns)]: ref('ver') }, label);
    versionRef = ref('ver');
  }

  // Components: update the target components by their order, create the extra ones, delete the removed ones.
  const old = header ? ctx.plan.catalog.components.get(header.id) ?? [] : [];
  const sorted = [...entry.components].sort((x, y) => Number(x.fields.Order__c ?? 0) - Number(y.fields.Order__c ?? 0));
  sorted.forEach((c, i) => {
    const componentId = ctx.audienceIds.get(c.audience.toLowerCase()) ?? null;
    const what = `${label}: component ${c.audience}`;
    if (old[i])
      g.patch(
        `c${i + 1}`,
        'AudienceSequenceComponent__c',
        old[i].Id,
        g.body('AudienceSequenceComponent__c', c.fields, 'update', { Audience__c: componentId }),
        what,
        c.fields
      );
    else
      g.post(
        `c${i + 1}`,
        'AudienceSequenceComponent__c',
        g.body('AudienceSequenceComponent__c', c.fields, 'create', {
          Audience__c: componentId,
          SequenceAudience__c: header ? header.id : ref('aud'),
        }),
        what,
        c.fields
      );
  });
  old
    .slice(sorted.length)
    .forEach((c, i) => g.delete(`cdel${i + 1}`, 'AudienceSequenceComponent__c', c.Id, `${label}: removed component`));

  addTree(g, entry.tree, {
    prefix: 'n',
    version: versionRef,
    label,
    outcomeId: (key) => ctx.outcomeIds.get(key),
    templateRefTarget: (r) =>
      writesTemplateReference(ctx.plan, r, ctx.plan.answers) ? ctx.templateIds.get(r.template) : undefined,
  });

  // The old tree: every filter object explicitly, because the version link and the parent link are "set null" lookups.
  const oldNodes = header?.versionId ? ctx.plan.oldTrees.get(header.versionId) ?? [] : [];
  oldNodes.forEach((id, i) => g.delete(`del${i + 1}`, 'AudienceFilterObject__c', id, `${label}: old filter object`));
  return g.build();
}

/** 5.3: creates the missing folders, parents first, in one graph. */
async function createFolders(ctx: RunContext, folders: FileFolder[]): Promise<LibraryResult[]> {
  if (!folders.length) return [];
  const g = new GraphBuilder(ctx.target, ctx.apiVersion);
  const refOf = new Map<string, string>();
  folders.forEach((f, i) => {
    const parentKey = f.parent?.toLowerCase();
    const parent = parentKey
      ? ctx.folderIds.get(parentKey) ?? (refOf.has(parentKey) ? ref(refOf.get(parentKey)!) : null)
      : null;
    refOf.set(f.uniqueName.toLowerCase(), `fo${i + 1}`);
    g.post(
      `fo${i + 1}`,
      'AudienceFolder__c',
      g.body('AudienceFolder__c', {}, 'create', { UniqueName__c: f.uniqueName, ParentFolder__c: parent }),
      f.path
    );
  });
  const result = await runNodes(ctx.target.conn, g.build().nodes);
  if (!result.ok) {
    const reason = result.error.message;
    return folders.map((f) => ({ kind: 'folder', name: f.path, status: 'failed', reason }));
  }
  return folders.map((f) => {
    const id = result.ids.get(refOf.get(f.uniqueName.toLowerCase())!)!;
    ctx.folderIds.set(f.uniqueName.toLowerCase(), id);
    return { kind: 'folder', name: f.path, status: 'created', targetId: id };
  });
}

/** 5.4: creates each missing template that an audience uses, one graph each. */
async function createTemplates(ctx: RunContext, used: Set<string>): Promise<LibraryResult[]> {
  const results: LibraryResult[] = [];
  const hasUnique = ctx.target.schema.objects.get('AudienceFilterObject__c')?.fields.has('UniqueName__c');
  for (const item of ctx.plan.templates.values()) {
    if (item.match.status === 'matched' || item.cannotCreate || !used.has(item.entry.key)) continue;
    const g = new GraphBuilder(ctx.target, ctx.apiVersion);
    addTree(g, item.entry.tree, {
      prefix: 't',
      version: null,
      label: item.entry.name,
      outcomeId: (key) => ctx.outcomeIds.get(key),
      templateRefTarget: () => undefined,
      rootExtra: {
        ...(hasUnique ? { UniqueName__c: item.entry.key } : {}),
        // A default template applies to every new audience in the org, so it stays a default only if the admin says so.
        ...(ctx.plan.answers.templateDefaults === 'clear'
          ? { IsDefault__c: false, IsLocked__c: false, DefaultApplicationMode__c: null, LockedNodeContexts__c: null }
          : {}),
      },
    });
    const plan = g.build();
    // eslint-disable-next-line no-await-in-loop
    const result = await runNodes(ctx.target.conn, plan.nodes);
    const root = item.entry.tree.find((n) => !n.parent);
    if (result.ok && root) {
      const id = result.ids.get(`t${root.ref}`)!;
      ctx.templateIds.set(item.entry.key, id);
      item.match = { status: 'matched', targetId: id, by: 'uniqueName' };
      results.push({ kind: 'template', name: item.entry.name, status: 'created', targetId: id });
    } else {
      const reason = result.ok
        ? messages.getMessage('error.emptyTemplate')
        : translateError(item.entry.name, result.error, plan.info, ctx.target.schema.ns, false);
      item.cannotCreate = reason;
      results.push({ kind: 'template', name: item.entry.name, status: 'failed', reason });
    }
  }
  return results;
}

/**
 * 5.4: creates each missing outcome definition that an audience uses, one graph each: the condition tree,
 * the definition, and version 1 with the snapshot from the file. Only the configuration: no cohorts,
 * holdouts, assignments, or measurements.
 */
async function createOutcomes(ctx: RunContext, used: Set<string>): Promise<LibraryResult[]> {
  const results: LibraryResult[] = [];
  const hasUnique = ctx.target.schema.objects.get('OutcomeDefinition__c')?.fields.has('UniqueName__c');
  for (const item of ctx.plan.outcomes.values()) {
    if (item.match.status === 'matched' || item.cannotCreate || !used.has(item.entry.key) || !item.entry.version)
      continue;
    const g = new GraphBuilder(ctx.target, ctx.apiVersion);
    addTree(g, item.entry.tree, {
      prefix: 'o',
      version: null,
      label: item.entry.name,
      outcomeId: () => undefined,
      templateRefTarget: () => undefined,
    });
    const root = item.entry.tree.find((n) => !n.parent);
    const rootRef = root ? ref(`o${root.ref}`) : null;
    g.post(
      'od',
      'OutcomeDefinition__c',
      g.body('OutcomeDefinition__c', item.entry.fields, 'create', {
        OutcomeTemplateRoot__c: rootRef,
        ...(hasUnique ? { UniqueName__c: item.entry.key } : {}),
      }),
      `${item.entry.name}: outcome definition`,
      item.entry.fields
    );
    g.post(
      'odv',
      'OutcomeDefinitionVersion__c',
      g.body('OutcomeDefinitionVersion__c', item.entry.version.fields, 'create', {
        OutcomeDefinition__c: ref('od'),
        OutcomeTemplateRoot__c: rootRef,
        VersionNumber__c: 1,
      }),
      `${item.entry.name}: outcome version`,
      item.entry.version.fields
    );
    const plan = g.build();
    // eslint-disable-next-line no-await-in-loop
    const result = await runNodes(ctx.target.conn, plan.nodes);
    if (result.ok) {
      const id = result.ids.get('od')!;
      ctx.outcomeIds.set(item.entry.key, id);
      item.match = { status: 'matched', targetId: id, by: 'uniqueName' };
      results.push({ kind: 'outcome', name: item.entry.name, status: 'created', targetId: id });
    } else {
      const reason = translateError(item.entry.name, result.error, plan.info, ctx.target.schema.ns, false);
      item.cannotCreate = reason;
      results.push({ kind: 'outcome', name: item.entry.name, status: 'failed', reason });
    }
  }
  return results;
}

function usedKeys(plan: Plan): { templates: Set<string>; outcomes: Set<string> } {
  const templates = new Set<string>();
  const outcomes = new Set<string>();
  for (const a of plan.audiences) {
    if (a.action !== 'create' && a.action !== 'update') continue;
    for (const n of a.entry.tree) {
      if (n.outcome) outcomes.add(n.outcome);
      for (const r of n.templateReferences) templates.add(r.template);
    }
  }
  // A template that the import creates can use an outcome definition too.
  for (const key of templates)
    for (const n of plan.templates.get(key)?.entry.tree ?? []) if (n.outcome) outcomes.add(n.outcome);
  return { templates, outcomes };
}

/** 5.3 to 5.9: writes the library records, then each audience in order. */
export async function runImport(plan: Plan, opts: RunOptions): Promise<ImportRun> {
  const target = plan.target;
  const ctx: RunContext = {
    plan,
    target,
    apiVersion: target.conn.getApiVersion(),
    now: opts.now.toISOString(),
    audienceIds: new Map(plan.catalog.audiences.filter((a) => a.apiName).map((a) => [a.apiName!.toLowerCase(), a.id])),
    folderIds: new Map(plan.folderIds),
    templateIds: new Map(
      [...plan.templates]
        .filter(([, t]) => t.match.status === 'matched')
        .map(([k, t]) => [k, (t.match as { targetId: string }).targetId])
    ),
    outcomeIds: new Map(
      [...plan.outcomes]
        .filter(([, o]) => o.match.status === 'matched')
        .map(([k, o]) => [k, (o.match as { targetId: string }).targetId])
    ),
  };
  const library: LibraryResult[] = [];
  if (plan.answers.folders === 'create') {
    library.push(...(await createFolders(ctx, plan.missingFolders)));
    plan.folderIds = new Map(ctx.folderIds);
  }
  const used = usedKeys(plan);
  // Outcome definitions first: a template can use one too.
  if (plan.answers.outcomes === 'create') library.push(...(await createOutcomes(ctx, used.outcomes)));
  if (plan.answers.templates === 'create') library.push(...(await createTemplates(ctx, used.templates)));
  // Recalculate with the created records: a failed template gives a warning, not a write (spec).
  if (library.some((l) => l.status === 'failed' || l.kind !== 'folder')) evaluatePlan(plan, plan.answers);

  const results: AudienceResult[] = [];
  const failed = new Map<string, string>();
  const toWrite = plan.audiences.filter((a) => a.action === 'create' || a.action === 'update');
  let done = 0;
  let stopped = false;
  for (const a of plan.audiences) {
    const base = { name: a.name, apiName: a.entry.apiName };
    if (a.action === 'unchanged') {
      results.push({ ...base, status: 'unchanged', targetId: a.target?.id });
      continue;
    }
    if (a.action === 'blocked') {
      results.push({ ...base, status: 'blocked', reason: a.blockers.join(' '), targetId: a.target?.id });
      failed.set(a.entry.apiName.toLowerCase(), 'blocked');
      continue;
    }
    if (stopped || opts.shouldStop()) {
      stopped = true;
      results.push({ ...base, status: 'notProcessed', targetId: a.target?.id });
      continue;
    }
    const dep = a.fileDependencies.find((d) => failed.has(d.toLowerCase()));
    if (dep) {
      const depPlan = plan.audiences.find((x) => x.entry.apiName.toLowerCase() === dep.toLowerCase());
      const why = failed.get(dep.toLowerCase()) === 'failed' ? 'failed' : 'was skipped';
      results.push({
        ...base,
        status: 'skipped',
        reason: messages.getMessage('skip.dependency', [depPlan?.label ?? dep, why]),
        targetId: a.target?.id,
      });
      failed.set(a.entry.apiName.toLowerCase(), 'skipped');
      continue;
    }
    opts.onProgress(++done, toWrite.length, a.label);
    const graph = buildAudienceGraph(ctx, a);
    // eslint-disable-next-line no-await-in-loop
    const result = await runNodes(target.conn, graph.nodes);
    const notAtomic = result.graphs > 1;
    if (result.ok) {
      const id = a.target?.id ?? result.ids.get('aud');
      if (id) ctx.audienceIds.set(a.entry.apiName.toLowerCase(), id);
      results.push({
        ...base,
        status: a.target ? 'updated' : 'created',
        targetId: id,
        ...(notAtomic ? { notAtomic } : {}),
      });
    } else {
      const reason = translateError(a.label, result.error, graph.info, target.schema.ns, opts.verbose);
      results.push({
        ...base,
        status: 'failed',
        reason: notAtomic ? `${reason} ${messages.getMessage('error.partial')}` : reason,
        targetId: a.target?.id,
      });
      failed.set(a.entry.apiName.toLowerCase(), 'failed');
      if (opts.failFast) stopped = true;
    }
  }
  return { audiences: results, library, stopped };
}
