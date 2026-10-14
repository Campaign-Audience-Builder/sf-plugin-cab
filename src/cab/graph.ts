import type { FieldValues, FileNode, FileTemplateReference } from './model.js';
import type { CabOrg } from './org.js';
import { addNs, definitionFields, ObjectInfo } from './schema.js';

export type GraphNode = {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  referenceId: string;
  body?: Record<string, unknown>;
};

/** What a graph node writes, for error messages (5.8). */
export type NodeInfo = { object: string; what: string; fields?: FieldValues };

export type GraphPlan = { nodes: GraphNode[]; info: Map<string, NodeInfo> };

/** A reference to the Id of an earlier node in the same graph. */
export const ref = (referenceId: string): string => `@{${referenceId}.id}`;

export class GraphBuilder {
  public readonly nodes: GraphNode[] = [];
  public readonly info = new Map<string, NodeInfo>();
  private readonly deletes: GraphNode[] = [];
  private readonly writable = new Map<string, { create: Set<string>; update: Set<string> }>();

  public constructor(public readonly target: CabOrg, private readonly apiVersion: string) {}

  public sobjectUrl(objectName: string, id?: string): string {
    const info = this.object(objectName);
    return `/services/data/v${this.apiVersion}/sobjects/${info.apiName}${id ? `/${id}` : ''}`;
  }

  public object(objectName: string): ObjectInfo {
    const info = this.target.schema.objects.get(objectName);
    if (!info) throw new Error(`Object ${objectName} does not exist in the target org.`);
    return info;
  }

  public has(objectName: string): boolean {
    return this.target.schema.objects.has(objectName);
  }

  /** The fields of the file record that the target can write (D5), with the namespace of the target. */
  public body(
    objectName: string,
    fields: FieldValues,
    mode: 'create' | 'update',
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
    let sets = this.writable.get(objectName);
    if (!sets) {
      const defs = definitionFields(this.object(objectName));
      sets = {
        create: new Set(defs.map((f) => f.name)),
        update: new Set(defs.filter((f) => f.updateable).map((f) => f.name)),
      };
      this.writable.set(objectName, sets);
    }
    const allowed = sets[mode];
    const ns = this.target.schema.ns;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) if (allowed.has(key)) out[addNs(key, ns)] = value ?? null;
    for (const [key, value] of Object.entries(extra)) {
      if (this.object(objectName).fields.has(key)) out[addNs(key, ns)] = value;
    }
    return out;
  }

  public post(
    referenceId: string,
    objectName: string,
    body: Record<string, unknown>,
    what: string,
    fields?: FieldValues
  ): void {
    this.nodes.push({ method: 'POST', url: this.sobjectUrl(objectName), referenceId, body });
    this.info.set(referenceId, { object: objectName, what, fields });
  }

  public patch(
    referenceId: string,
    objectName: string,
    id: string,
    body: Record<string, unknown>,
    what: string,
    fields?: FieldValues
  ): void {
    this.nodes.push({ method: 'PATCH', url: this.sobjectUrl(objectName, id), referenceId, body });
    this.info.set(referenceId, { object: objectName, what, fields });
  }

  /** Deletes go after all inserts, so the non-atomic path creates the new records before it deletes the old ones (D8). */
  public delete(referenceId: string, objectName: string, id: string, what: string): void {
    this.deletes.push({ method: 'DELETE', url: this.sobjectUrl(objectName, id), referenceId });
    this.info.set(referenceId, { object: objectName, what });
  }

  public build(): GraphPlan {
    return { nodes: [...this.nodes, ...this.deletes], info: this.info };
  }
}

export type TreeContext = {
  /** Reference prefix, so two trees in one graph do not share reference Ids. */
  prefix: string;
  /** The version Id or graph reference for audience trees. Null for templates and outcome definitions. */
  version: string | null;
  /** Extra fields for the root node, for example UniqueName__c of a created template. */
  rootExtra?: Record<string, unknown>;
  label: string;
  outcomeId(key: string): string | undefined;
  /** The target Id of a template reference that the import writes, or undefined to leave it out. */
  templateRefTarget(r: FileTemplateReference): string | undefined;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Orders data inclusions so that a parent comes before its children. */
function parentFirst<T extends { ref: string; parent: string | null }>(items: T[]): T[] {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const out: T[] = [];
  const done = new Set<string>();
  const visit = (i: T, path: Set<string>): void => {
    if (done.has(i.ref)) return;
    const p = i.parent ? byRef.get(i.parent) : undefined;
    if (p && !path.has(p.ref)) visit(p, new Set([...path, i.ref]));
    done.add(i.ref);
    out.push(i);
  };
  items.forEach((i) => visit(i, new Set([i.ref])));
  return out;
}

/** D8 step 5: POST the filter objects parents first, then their filters, data inclusions, sorts, and template references. */
export function addTree(g: GraphBuilder, nodes: FileNode[], ctx: TreeContext): void {
  const id = (localRef: string): string => `${ctx.prefix}${localRef}`;
  const index = new Map(nodes.map((n, i) => [n.ref, i]));
  const filterNode = new Map<string, number>();
  nodes.forEach((n, i) => n.filters.forEach((f) => filterNode.set(f.ref, i)));
  const patches: Array<() => void> = [];

  nodes.forEach((n, i) => {
    const extra: Record<string, unknown> = { AudienceVersion__c: ctx.version };
    if (n.parent) extra.ParentAudienceFilterObject__c = ref(id(n.parent));
    if (n.aggregateChainStart) {
      if ((index.get(n.aggregateChainStart) ?? Infinity) < i)
        extra.AggregateChainStart__c = ref(id(n.aggregateChainStart));
      else {
        const start = n.aggregateChainStart;
        patches.push(() =>
          g.patch(
            `${id(n.ref)}c`,
            'AudienceFilterObject__c',
            ref(id(n.ref)),
            { [addNs('AggregateChainStart__c', g.target.schema.ns)]: ref(id(start)) },
            `${ctx.label}: filter object`
          )
        );
      }
    }
    if (n.outcome) extra.OutcomeDefinition__c = ctx.outcomeId(n.outcome) ?? null;
    if (!n.parent && ctx.rootExtra) Object.assign(extra, ctx.rootExtra);
    g.post(
      id(n.ref),
      'AudienceFilterObject__c',
      g.body('AudienceFilterObject__c', n.fields, 'create', extra),
      `${ctx.label}: filter object ${text(n.fields.SObjectName__c)}`,
      n.fields
    );
  });
  patches.forEach((p) => p());

  for (const n of nodes) {
    for (const f of n.filters) {
      g.post(
        id(f.ref),
        'QueryFilter__c',
        g.body('QueryFilter__c', f.fields, 'create', {
          AudienceFilterObject__c: ref(id(n.ref)),
          AudienceVersion__c: ctx.version,
        }),
        `${ctx.label}: filter ${text(f.fields.FilterFieldAPIName__c)}`,
        f.fields
      );
    }
  }
  if (g.has('AudienceDataInclusion__c')) {
    const all = nodes.flatMap((n) => n.dataInclusions.map((d) => ({ ...d, node: n.ref })));
    for (const d of parentFirst(all)) {
      const extra: Record<string, unknown> = { AudienceFilterObject__c: ref(id(d.node)) };
      if (d.parent) extra.ParentAudienceDataInclusion__c = ref(id(d.parent));
      if (d.aggregateFilter && filterNode.has(d.aggregateFilter))
        extra.AggregateQueryFilter__c = ref(id(d.aggregateFilter));
      g.post(
        id(d.ref),
        'AudienceDataInclusion__c',
        g.body('AudienceDataInclusion__c', d.fields, 'create', extra),
        `${ctx.label}: data inclusion ${text(d.fields.FieldAPIName__c)}`,
        d.fields
      );
      if (!g.has('IntermediateSortConfiguration__c')) continue;
      d.sorts.forEach((s, k) => {
        const sortExtra: Record<string, unknown> = { AudienceDataInclusion__c: ref(id(d.ref)) };
        if (s.filterObject) sortExtra.AudienceFilterObject__c = ref(id(s.filterObject));
        g.post(
          `${id(d.ref)}s${k + 1}`,
          'IntermediateSortConfiguration__c',
          g.body('IntermediateSortConfiguration__c', s.fields, 'create', sortExtra),
          `${ctx.label}: sort configuration`,
          s.fields
        );
      });
    }
  }
  if (g.has('AudienceFilterTemplateReference__c')) {
    for (const n of nodes) {
      n.templateReferences.forEach((r, k) => {
        const templateId = ctx.templateRefTarget(r);
        if (!templateId) return;
        g.post(
          `${id(n.ref)}t${k + 1}`,
          'AudienceFilterTemplateReference__c',
          g.body('AudienceFilterTemplateReference__c', r.fields, 'create', {
            AudienceFilterObject__c: ref(id(n.ref)),
            FilterTemplate__c: templateId,
          }),
          `${ctx.label}: link to template ${r.template}`,
          r.fields
        );
      });
    }
  }
}
