import { sha256 } from './json.js';
import type { FieldValues, FileAudience, FileDataInclusion, FileNode, FileTemplateReference } from './model.js';

/** The fields of each object that the comparison uses. A missing object means "no fields". */
export type FieldFilter = (objectName: string) => Set<string> | undefined;

function project(fields: FieldValues, allowed: Set<string> | undefined): FieldValues {
  const out: FieldValues = {};
  if (!allowed) return out;
  for (const key of Object.keys(fields).sort()) if (allowed.has(key)) out[key] = fields[key] ?? null;
  return out;
}

const byNumber =
  (field: string) =>
  (a: { fields: FieldValues }, b: { fields: FieldValues }): number =>
    Number(a.fields[field] ?? 0) - Number(b.fields[field] ?? 0);

/**
 * Puts a tree in canonical order again, with new refs. The order depends only on the content, so two
 * trees with the same content get the same refs. Use this after fields were removed from a tree.
 */
export function canonicalTree(nodes: FileNode[]): FileNode[] {
  const children = new Map<string | null, FileNode[]>();
  const refs = new Set(nodes.map((n) => n.ref));
  for (const n of nodes) {
    const parent = n.parent && refs.has(n.parent) ? n.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  const content = (n: FileNode): FileNode => ({
    ...n,
    filters: [...n.filters].sort(
      (a, b) => byNumber('ConditionNumber__c')(a, b) || sha256(a.fields).localeCompare(sha256(b.fields))
    ),
    dataInclusions: [...n.dataInclusions].sort((a, b) => sha256(diContent(a)).localeCompare(sha256(diContent(b)))),
    templateReferences: [...n.templateReferences].sort((a, b) => sha256(a).localeCompare(sha256(b))),
  });
  const sigs = new Map<string, string>();
  const sig = (n: FileNode, seen: Set<string>): string => {
    seen.add(n.ref);
    const kids = (children.get(n.ref) ?? [])
      .filter((c) => !seen.has(c.ref))
      .map((c) => sig(c, seen))
      .sort();
    const c = content(n);
    const s = sha256({
      fields: c.fields,
      outcome: c.outcome,
      filters: c.filters.map((f) => f.fields),
      dataInclusions: c.dataInclusions.map(diContent),
      templateReferences: c.templateReferences,
      kids,
    });
    sigs.set(n.ref, s);
    return s;
  };
  const seen = new Set<string>();
  for (const root of children.get(null) ?? []) sig(root, seen);

  const ordered: FileNode[] = [];
  const visit = (n: FileNode): void => {
    ordered.push(n);
    [...(children.get(n.ref) ?? [])]
      .sort((a, b) => (sigs.get(a.ref) ?? '').localeCompare(sigs.get(b.ref) ?? ''))
      .forEach(visit);
  };
  [...(children.get(null) ?? [])]
    .sort((a, b) => (sigs.get(a.ref) ?? '').localeCompare(sigs.get(b.ref) ?? ''))
    .forEach(visit);

  const nodeRef = new Map<string, string>();
  const filterRef = new Map<string, string>();
  const diRef = new Map<string, string>();
  let f = 0;
  let d = 0;
  const sorted = ordered.map(content);
  sorted.forEach((n, i) => {
    nodeRef.set(n.ref, `n${i + 1}`);
    for (const x of n.filters) filterRef.set(x.ref, `f${++f}`);
    for (const x of n.dataInclusions) diRef.set(x.ref, `d${++d}`);
  });
  const map = (m: Map<string, string>, ref: string | null): string | null => (ref ? m.get(ref) ?? null : null);
  return sorted.map((n) => ({
    ...n,
    ref: nodeRef.get(n.ref)!,
    parent: map(nodeRef, n.parent),
    aggregateChainStart: map(nodeRef, n.aggregateChainStart),
    filters: n.filters.map((x) => ({ ...x, ref: filterRef.get(x.ref)! })),
    dataInclusions: n.dataInclusions.map((x) => ({
      ...x,
      ref: diRef.get(x.ref)!,
      parent: map(diRef, x.parent),
      aggregateFilter: map(filterRef, x.aggregateFilter),
      sorts: x.sorts.map((s) => ({ ...s, filterObject: map(nodeRef, s.filterObject) })),
    })),
  }));
}

function diContent(d: FileDataInclusion): unknown {
  return { fields: d.fields, sorts: d.sorts.map((s) => s.fields) };
}

/** Projects a tree onto the allowed fields, without cleared links, and keeps only the template references that `keepRef` accepts. */
export function projectTree(
  nodes: FileNode[],
  allowed: FieldFilter,
  keepRef: (r: FileTemplateReference) => boolean
): FileNode[] {
  const projected = nodes.map(
    (n): FileNode => ({
      ref: n.ref,
      parent: n.parent,
      aggregateChainStart: n.aggregateChainStart,
      outcome: n.outcome,
      fields: project(n.fields, allowed('AudienceFilterObject__c')),
      filters: allowed('QueryFilter__c')
        ? n.filters.map((x) => ({ ref: x.ref, fields: project(x.fields, allowed('QueryFilter__c')) }))
        : [],
      dataInclusions: allowed('AudienceDataInclusion__c')
        ? n.dataInclusions.map((x) => ({
            ref: x.ref,
            parent: x.parent,
            aggregateFilter: x.aggregateFilter,
            fields: project(x.fields, allowed('AudienceDataInclusion__c')),
            sorts: allowed('IntermediateSortConfiguration__c')
              ? x.sorts.map((s) => ({
                  filterObject: s.filterObject,
                  fields: project(s.fields, allowed('IntermediateSortConfiguration__c')),
                }))
              : [],
          }))
        : [],
      templateReferences: allowed('AudienceFilterTemplateReference__c')
        ? n.templateReferences
            .filter(keepRef)
            .map((t) => ({
              template: t.template,
              fields: project(t.fields, allowed('AudienceFilterTemplateReference__c')),
            }))
        : [],
    })
  );
  return canonicalTree(projected);
}

export type NormalizeOptions = {
  allowed: FieldFilter;
  keepRef: (r: FileTemplateReference) => boolean;
  /** Compare the folder only if the import writes it. */
  compareFolder: boolean;
};

/** D9: the normalized form of an audience. No Ids, sorted fields, a stable tree order. */
export function normalizeAudience(a: FileAudience, opts: NormalizeOptions): unknown {
  return {
    apiName: a.apiName.toLowerCase(),
    folder: opts.compareFolder ? (a.folder ?? '').toLowerCase() : undefined,
    fields: project(a.fields, opts.allowed('Audience__c')),
    version: project(a.version.fields, opts.allowed('AudienceVersion__c')),
    components: a.components.map((c) => ({
      audience: c.audience.toLowerCase(),
      fields: project(c.fields, opts.allowed('AudienceSequenceComponent__c')),
    })),
    tree: projectTree(a.tree, opts.allowed, opts.keepRef),
  };
}

export function hashAudience(a: FileAudience, opts: NormalizeOptions): string {
  return sha256(normalizeAudience(a, opts));
}

/** The field names that the file uses for each object. */
export function fileFieldNames(audiences: FileAudience[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (object: string, fields: FieldValues): void => {
    const set = out.get(object) ?? new Set<string>();
    for (const k of Object.keys(fields)) set.add(k);
    out.set(object, set);
  };
  const addTree = (nodes: FileNode[]): void => {
    for (const n of nodes) {
      add('AudienceFilterObject__c', n.fields);
      for (const f of n.filters) add('QueryFilter__c', f.fields);
      for (const d of n.dataInclusions) {
        add('AudienceDataInclusion__c', d.fields);
        for (const s of d.sorts) add('IntermediateSortConfiguration__c', s.fields);
      }
      for (const t of n.templateReferences) add('AudienceFilterTemplateReference__c', t.fields);
    }
  };
  for (const a of audiences) {
    add('Audience__c', a.fields);
    add('AudienceVersion__c', a.version.fields);
    for (const c of a.components) add('AudienceSequenceComponent__c', c.fields);
    addTree(a.tree);
  }
  return out;
}
