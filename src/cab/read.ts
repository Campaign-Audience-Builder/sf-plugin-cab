import type { CabOrg } from './org.js';
import { addNs, definitionFields, ObjectInfo, referenceFields, stripNs } from './schema.js';

/** A record with field names that have no namespace prefix. */
export type Raw = Record<string, unknown> & { Id: string };

const IN_CHUNK = 300;

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The fields that the reader selects for an object: Id, Name, definition fields, and reference fields. */
export function selectFields(info: ObjectInfo, extra: string[] = []): string[] {
  const names = new Set(['Id', ...extra]);
  if (info.fields.has('Name')) names.add('Name');
  for (const f of definitionFields(info)) names.add(f.name);
  for (const f of referenceFields(info)) names.add(f.name);
  return [...names].filter((n) => info.fields.has(n));
}

function unprefix(record: Record<string, unknown>, ns: string): Raw {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'attributes') continue;
    out[stripNs(key, ns)] = value;
  }
  return out as Raw;
}

/** Queries all records of an object, with an optional WHERE clause in unprefixed field names. */
export async function queryRaw(cab: CabOrg, objectName: string, fields: string[], where?: string): Promise<Raw[]> {
  const info = cab.schema.objects.get(objectName);
  if (!info?.queryable) return [];
  const ns = cab.schema.ns;
  const soql =
    `SELECT ${fields.map((f) => addNs(f, ns)).join(', ')} FROM ${info.apiName}` +
    (where ? ` WHERE ${where.replace(/\b([A-Za-z0-9_]+__c)\b/g, (m) => addNs(m, ns))}` : '');
  const result = await cab.conn.autoFetchQuery(soql, { maxFetch: 1_000_000 });
  return (result.records as Array<Record<string, unknown>>).map((r) => unprefix(r, ns));
}

/** Queries the records of an object where `field` is in `values`, in chunks. */
export async function queryIn(
  cab: CabOrg,
  objectName: string,
  fields: string[],
  field: string,
  values: string[]
): Promise<Raw[]> {
  const unique = [...new Set(values)];
  const out: Raw[] = [];
  for (const chunk of chunks(unique, IN_CHUNK)) {
    // Chunks run one at a time, so a large org does not hit the concurrent request limit.
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await queryRaw(cab, objectName, fields, `${field} IN (${chunk.map(quote).join(', ')})`)));
  }
  return out;
}

function fieldsOf(cab: CabOrg, objectName: string, extra: string[] = []): string[] {
  const info = cab.schema.objects.get(objectName);
  return info ? selectFields(info, extra) : [];
}

export type Folder = { id: string; uniqueName: string; parentId: string | null; path: string };

export async function loadFolders(cab: CabOrg): Promise<Map<string, Folder>> {
  const records = await queryRaw(cab, 'AudienceFolder__c', ['Id', 'UniqueName__c', 'ParentFolder__c']);
  const byId = new Map(records.map((r) => [r.Id, r]));
  const folders = new Map<string, Folder>();
  const pathOf = (id: string, seen = new Set<string>()): string => {
    const r = byId.get(id);
    if (!r) return '';
    const parent = str(r.ParentFolder__c);
    const name = str(r.UniqueName__c) ?? id;
    if (!parent || seen.has(parent) || !byId.has(parent)) return name;
    seen.add(id);
    return `${pathOf(parent, seen)}/${name}`;
  };
  for (const r of records) {
    folders.set(r.Id, {
      id: r.Id,
      uniqueName: str(r.UniqueName__c) ?? r.Id,
      parentId: str(r.ParentFolder__c),
      path: pathOf(r.Id),
    });
  }
  return folders;
}

export type AudienceHeader = {
  id: string;
  name: string;
  apiName: string | null;
  type: string;
  folderId: string | null;
  folderPath: string | null;
  versionId: string | null;
  lastModified: string;
  raw: Raw;
};

/** Loads all audiences of the org, with their folder paths and their version Ids. */
export async function loadAudiences(cab: CabOrg, folders: Map<string, Folder>): Promise<AudienceHeader[]> {
  const records = await queryRaw(
    cab,
    'Audience__c',
    fieldsOf(cab, 'Audience__c', ['LastModifiedDate', 'AudienceAPIName__c', 'Type__c'])
  );
  const versions = await queryRaw(cab, 'AudienceVersion__c', ['Id', 'Audience__c', 'VersionNumber__c']);
  // LatestVersion__c is the active version. If it is empty, the version with the highest number is used.
  const fallback = new Map<string, Raw>();
  for (const v of versions) {
    const audienceId = str(v.Audience__c);
    if (!audienceId) continue;
    const current = fallback.get(audienceId);
    if (!current || Number(v.VersionNumber__c ?? 0) > Number(current.VersionNumber__c ?? 0))
      fallback.set(audienceId, v);
  }
  return records.map((r) => {
    const folderId = str(r.AudienceFolder__c);
    return {
      id: r.Id,
      name: str(r.Name) ?? '',
      apiName: str(r.AudienceAPIName__c),
      type: str(r.Type__c) ?? 'Standard',
      folderId,
      folderPath: folderId ? folders.get(folderId)?.path ?? null : null,
      versionId: str(r.LatestVersion__c) ?? fallback.get(r.Id)?.Id ?? null,
      lastModified: str(r.LastModifiedDate) ?? '',
      raw: r,
    };
  });
}

/** Loads the sequence components of all audiences, sorted by order. */
export async function loadComponents(cab: CabOrg): Promise<Map<string, Raw[]>> {
  const records = await queryRaw(cab, 'AudienceSequenceComponent__c', fieldsOf(cab, 'AudienceSequenceComponent__c'));
  const bySequence = new Map<string, Raw[]>();
  for (const r of records) {
    const seq = str(r.SequenceAudience__c);
    if (!seq) continue;
    const list = bySequence.get(seq) ?? [];
    list.push(r);
    bySequence.set(seq, list);
  }
  for (const list of bySequence.values()) list.sort((a, b) => Number(a.Order__c ?? 0) - Number(b.Order__c ?? 0));
  return bySequence;
}

/** All records of one filter tree. */
export type RawTree = {
  nodes: Raw[];
  filters: Raw[];
  dataInclusions: Raw[];
  sorts: Raw[];
  templateReferences: Raw[];
};

/**
 * Loads complete filter trees in bulk: the nodes of the given versions or roots, then their descendants,
 * then the records below the nodes. The result maps each version Id or root Id to its tree.
 */
export async function loadTrees(
  cab: CabOrg,
  by: { versionIds?: string[]; rootIds?: string[] }
): Promise<Map<string, RawTree>> {
  const nodeFields = fieldsOf(cab, 'AudienceFilterObject__c');
  const nodes = new Map<string, Raw>();
  if (by.versionIds?.length) {
    for (const n of await queryIn(cab, 'AudienceFilterObject__c', nodeFields, 'AudienceVersion__c', by.versionIds))
      nodes.set(n.Id, n);
  }
  if (by.rootIds?.length) {
    for (const n of await queryIn(cab, 'AudienceFilterObject__c', nodeFields, 'Id', by.rootIds)) nodes.set(n.Id, n);
  }
  // Child nodes can have no version link, so the reader also follows the parent lookup down.
  let frontier = [...nodes.keys()];
  while (frontier.length) {
    // eslint-disable-next-line no-await-in-loop
    const children = await queryIn(
      cab,
      'AudienceFilterObject__c',
      nodeFields,
      'ParentAudienceFilterObject__c',
      frontier
    );
    frontier = [];
    for (const c of children) {
      if (!nodes.has(c.Id)) {
        nodes.set(c.Id, c);
        frontier.push(c.Id);
      }
    }
  }
  const nodeIds = [...nodes.keys()];
  const [filters, dataInclusions, templateReferences] = await Promise.all([
    queryIn(cab, 'QueryFilter__c', fieldsOf(cab, 'QueryFilter__c'), 'AudienceFilterObject__c', nodeIds),
    queryIn(
      cab,
      'AudienceDataInclusion__c',
      fieldsOf(cab, 'AudienceDataInclusion__c'),
      'AudienceFilterObject__c',
      nodeIds
    ),
    queryIn(
      cab,
      'AudienceFilterTemplateReference__c',
      fieldsOf(cab, 'AudienceFilterTemplateReference__c'),
      'AudienceFilterObject__c',
      nodeIds
    ),
  ]);
  const sorts = await queryIn(
    cab,
    'IntermediateSortConfiguration__c',
    fieldsOf(cab, 'IntermediateSortConfiguration__c'),
    'AudienceDataInclusion__c',
    dataInclusions.map((d) => d.Id)
  );

  return groupTrees(nodes, by.versionIds ?? [], { filters, dataInclusions, templateReferences, sorts });
}

/** Puts each node, and each record below a node, into the tree of its version or of its root node. */
function groupTrees(
  nodes: Map<string, Raw>,
  versionIds: string[],
  below: { filters: Raw[]; dataInclusions: Raw[]; templateReferences: Raw[]; sorts: Raw[] }
): Map<string, RawTree> {
  const { filters, dataInclusions, templateReferences, sorts } = below;
  const versions = new Set(versionIds);
  const rootOf = (n: Raw): string => {
    const seen = new Set<string>();
    let current = n;
    while (true) {
      const version = str(current.AudienceVersion__c);
      if (version && versions.has(version)) return version;
      const parent = str(current.ParentAudienceFilterObject__c);
      if (!parent || seen.has(parent) || !nodes.has(parent)) return current.Id;
      seen.add(parent);
      current = nodes.get(parent)!;
    }
  };
  const trees = new Map<string, RawTree>();
  const treeOfNode = new Map<string, RawTree>();
  for (const n of nodes.values()) {
    const key = rootOf(n);
    let tree = trees.get(key);
    if (!tree) {
      tree = { nodes: [], filters: [], dataInclusions: [], sorts: [], templateReferences: [] };
      trees.set(key, tree);
    }
    tree.nodes.push(n);
    treeOfNode.set(n.Id, tree);
  }
  const diTree = new Map<string, RawTree>();
  for (const f of filters) treeOfNode.get(str(f.AudienceFilterObject__c) ?? '')?.filters.push(f);
  for (const t of templateReferences) treeOfNode.get(str(t.AudienceFilterObject__c) ?? '')?.templateReferences.push(t);
  for (const d of dataInclusions) {
    const tree = treeOfNode.get(str(d.AudienceFilterObject__c) ?? '');
    if (tree) {
      tree.dataInclusions.push(d);
      diTree.set(d.Id, tree);
    }
  }
  for (const s of sorts) diTree.get(str(s.AudienceDataInclusion__c) ?? '')?.sorts.push(s);
  return trees;
}

export async function loadVersions(cab: CabOrg, versionIds: string[]): Promise<Map<string, Raw>> {
  const records = await queryIn(cab, 'AudienceVersion__c', fieldsOf(cab, 'AudienceVersion__c'), 'Id', versionIds);
  return new Map(records.map((r) => [r.Id, r]));
}

/** Filter Library templates: root nodes with IsTemplate__c and no version, and not outcome templates. */
export async function loadTemplateRoots(cab: CabOrg): Promise<Raw[]> {
  const info = cab.schema.objects.get('AudienceFilterObject__c');
  if (!info?.fields.has('IsTemplate__c')) return [];
  const extra = info.fields.has('UniqueName__c') ? ['UniqueName__c'] : [];
  const outcome = info.fields.has('IsOutcomeTemplate__c') ? ' AND IsOutcomeTemplate__c = false' : '';
  return queryRaw(
    cab,
    'AudienceFilterObject__c',
    selectFields(info, extra),
    `IsTemplate__c = true AND AudienceVersion__c = null AND ParentAudienceFilterObject__c = null${outcome}`
  );
}

export async function loadOutcomeDefinitions(cab: CabOrg): Promise<Raw[]> {
  const info = cab.schema.objects.get('OutcomeDefinition__c');
  if (!info) return [];
  return queryRaw(
    cab,
    'OutcomeDefinition__c',
    selectFields(info, info.fields.has('UniqueName__c') ? ['UniqueName__c'] : [])
  );
}

/**
 * Versions with a run in progress: an AudienceRun__c with no end time and no error log, as
 * AudienceRun_Selector.getInFlightRunForVersion. A run that started more than 24 hours ago and never
 * ended is stale, so it does not block the import.
 */
export async function loadRunningVersions(cab: CabOrg, versionIds: string[], now = Date.now()): Promise<Set<string>> {
  const info = cab.schema.objects.get('AudienceRun__c');
  if (!info || !versionIds.length) return new Set();
  const fields = ['Id', 'AudienceVersion__c', 'RunEndTime__c', 'RunStartTime__c', 'CreatedDate', 'ErrorLog__c'].filter(
    (f) => info.fields.has(f)
  );
  const records = await queryIn(cab, 'AudienceRun__c', fields, 'AudienceVersion__c', versionIds);
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return new Set(
    records
      .filter((r) => !r.RunEndTime__c && !r.ErrorLog__c)
      .filter((r) => Date.parse(str(r.RunStartTime__c) ?? str(r.CreatedDate) ?? '') > dayAgo)
      .map((r) => str(r.AudienceVersion__c) ?? '')
  );
}
