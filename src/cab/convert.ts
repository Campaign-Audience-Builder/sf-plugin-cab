import { sha256 } from './json.js';
import type {
  FieldValues,
  FileAudience,
  FileDataInclusion,
  FileFilter,
  FileNode,
  FileRecord,
  FileSort,
  FileTemplateReference,
} from './model.js';
import type { Raw, RawTree } from './read.js';
import { str } from './read.js';
import { definitionFields, referenceFields, referenceRule, Schema } from './schema.js';

/** Fields that the file carries outside `fields`. */
const CARRIED_ELSEWHERE: Record<string, Set<string>> = {
  Audience__c: new Set(['AudienceAPIName__c']),
  AudienceFilterObject__c: new Set(['UniqueName__c']),
};

/** Resolves records outside the tree to their keys in the file. */
export type KeyResolver = {
  template(id: string): string | null;
  outcome(id: string): string | null;
};

function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === '') return null;
  return value;
}

/** Converts one record to `{ fields, clearedLinks }`. Reference fields with a rule are left to the caller. */
export function toFileRecord(schema: Schema, objectName: string, raw: Raw): FileRecord {
  const info = schema.objects.get(objectName);
  if (!info) return { fields: {} };
  const fields: FieldValues = {};
  const skip = CARRIED_ELSEWHERE[objectName];
  for (const f of definitionFields(info)) {
    if (skip?.has(f.name)) continue;
    fields[f.name] = normalizeValue(raw[f.name]);
  }
  const cleared: string[] = [];
  for (const f of referenceFields(info)) {
    if (referenceRule(objectName, f.name)) continue;
    if (str(raw[f.name])) cleared.push(f.name);
  }
  return cleared.length ? { fields, clearedLinks: cleared.sort() } : { fields };
}

type Draft = {
  raw: Raw;
  record: FileRecord;
  outcome: string | null;
  filters: Array<{ raw: Raw; record: FileRecord; sig: string }>;
  dataInclusions: Array<{ raw: Raw; record: FileRecord; sorts: Array<{ raw: Raw; record: FileRecord }>; sig: string }>;
  templateReferences: FileTemplateReference[];
  children: Draft[];
  sig: string;
};

function byNumberThen(a: unknown, b: unknown): number {
  return Number(a ?? 0) - Number(b ?? 0);
}

/**
 * Converts the records of one filter tree to the file form (D7), in a canonical order. Siblings are
 * sorted by their content, so the same tree gives the same file in every org. `ref` values are assigned
 * in that order: nodes n1, n2, ..., filters f1, f2, ..., data inclusions d1, d2, ...
 */
export function convertTree(schema: Schema, tree: RawTree, keys: KeyResolver): FileNode[] {
  const children = new Map<string | null, Raw[]>();
  const nodeIds = new Set(tree.nodes.map((n) => n.Id));
  for (const n of tree.nodes) {
    const parent = str(n.ParentAudienceFilterObject__c);
    const key = parent && nodeIds.has(parent) ? parent : null;
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  const group = <T extends Raw>(records: T[], field: string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of records) {
      const k = str(r[field]) ?? '';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const filtersOf = group(tree.filters, 'AudienceFilterObject__c');
  const disOf = group(tree.dataInclusions, 'AudienceFilterObject__c');
  const sortsOf = group(tree.sorts, 'AudienceDataInclusion__c');
  const refsOf = group(tree.templateReferences, 'AudienceFilterObject__c');

  const draft = (n: Raw, seen: Set<string>): Draft => {
    seen.add(n.Id);
    const filters = (filtersOf.get(n.Id) ?? [])
      .map((raw) => {
        const record = toFileRecord(schema, 'QueryFilter__c', raw);
        return { raw, record, sig: sha256(record) };
      })
      .sort(
        (a, b) =>
          byNumberThen(a.record.fields.ConditionNumber__c, b.record.fields.ConditionNumber__c) ||
          a.sig.localeCompare(b.sig)
      );
    const dataInclusions = (disOf.get(n.Id) ?? [])
      .map((raw) => {
        const record = toFileRecord(schema, 'AudienceDataInclusion__c', raw);
        const sorts = (sortsOf.get(raw.Id) ?? [])
          .map((s) => ({ raw: s, record: toFileRecord(schema, 'IntermediateSortConfiguration__c', s) }))
          .sort(
            (a, b) =>
              byNumberThen(a.record.fields.SortSequence__c, b.record.fields.SortSequence__c) ||
              sha256(a.record).localeCompare(sha256(b.record))
          );
        return { raw, record, sorts, sig: sha256({ record, sorts: sorts.map((s) => s.record) }) };
      })
      .sort((a, b) => a.sig.localeCompare(b.sig));
    const templateReferences = (refsOf.get(n.Id) ?? [])
      .map((raw): FileTemplateReference => {
        const record = toFileRecord(schema, 'AudienceFilterTemplateReference__c', raw);
        return { template: keys.template(str(raw.FilterTemplate__c) ?? '') ?? '', ...record };
      })
      .filter((t) => t.template)
      .sort((a, b) => sha256(a).localeCompare(sha256(b)));
    const kids = (children.get(n.Id) ?? []).filter((c) => !seen.has(c.Id)).map((c) => draft(c, seen));
    kids.sort((a, b) => a.sig.localeCompare(b.sig) || a.raw.Id.localeCompare(b.raw.Id));
    const record = toFileRecord(schema, 'AudienceFilterObject__c', n);
    const outcomeId = str(n.OutcomeDefinition__c);
    const outcome = outcomeId ? keys.outcome(outcomeId) : null;
    const sig = sha256({
      record,
      outcome,
      filters: filters.map((f) => f.sig),
      dataInclusions: dataInclusions.map((d) => d.sig),
      templateReferences,
      children: kids.map((k) => k.sig),
    });
    return { raw: n, record, outcome, filters, dataInclusions, templateReferences, children: kids, sig };
  };

  const seen = new Set<string>();
  const roots = (children.get(null) ?? []).map((r) => draft(r, seen));
  roots.sort((a, b) => a.sig.localeCompare(b.sig) || a.raw.Id.localeCompare(b.raw.Id));

  // Assign refs in depth-first order, parents first.
  const ordered: Draft[] = [];
  const visit = (d: Draft): void => {
    ordered.push(d);
    d.children.forEach(visit);
  };
  roots.forEach(visit);
  const nodeRef = new Map<string, string>();
  const filterRef = new Map<string, string>();
  const diRef = new Map<string, string>();
  let f = 0;
  let di = 0;
  ordered.forEach((d, i) => {
    nodeRef.set(d.raw.Id, `n${i + 1}`);
    for (const x of d.filters) filterRef.set(x.raw.Id, `f${++f}`);
    for (const x of d.dataInclusions) diRef.set(x.raw.Id, `d${++di}`);
  });
  const local = (map: Map<string, string>, id: unknown): string | null => map.get(str(id) ?? '') ?? null;

  return ordered.map(
    (d): FileNode => ({
      ref: nodeRef.get(d.raw.Id)!,
      parent: local(nodeRef, d.raw.ParentAudienceFilterObject__c),
      aggregateChainStart: local(nodeRef, d.raw.AggregateChainStart__c),
      outcome: d.outcome,
      ...d.record,
      filters: d.filters.map((x): FileFilter => ({ ref: filterRef.get(x.raw.Id)!, ...x.record })),
      dataInclusions: d.dataInclusions.map(
        (x): FileDataInclusion => ({
          ref: diRef.get(x.raw.Id)!,
          parent: local(diRef, x.raw.ParentAudienceDataInclusion__c),
          aggregateFilter: local(filterRef, x.raw.AggregateQueryFilter__c),
          ...x.record,
          sorts: x.sorts.map(
            (s): FileSort => ({ filterObject: local(nodeRef, s.raw.AudienceFilterObject__c), ...s.record })
          ),
        })
      ),
      templateReferences: d.templateReferences,
    })
  );
}

/** Converts an audience with its version, components, and tree to the file form. */
export function convertAudience(
  schema: Schema,
  input: {
    audience: Raw;
    apiName: string;
    folderPath: string | null;
    version: Raw | undefined;
    components: Array<{ raw: Raw; audienceApiName: string }>;
    tree: RawTree | undefined;
  },
  keys: KeyResolver
): FileAudience {
  return {
    apiName: input.apiName,
    folder: input.folderPath,
    ...toFileRecord(schema, 'Audience__c', input.audience),
    version: input.version ? toFileRecord(schema, 'AudienceVersion__c', input.version) : { fields: {} },
    components: input.components.map((c) => ({
      audience: c.audienceApiName,
      ...toFileRecord(schema, 'AudienceSequenceComponent__c', c.raw),
    })),
    tree: input.tree ? convertTree(schema, input.tree, keys) : [],
  };
}
