import type { FileNode } from './model.js';
import type { CabOrg } from './org.js';
import { addNs } from './schema.js';

export type TreeProblem =
  | { kind: 'object'; object: string }
  | { kind: 'field'; object: string; field: string }
  | { kind: 'class'; className: string };

const PLAIN_FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The objects and plain field names that a tree uses. Field paths with a dot are not checked.
 * The lookup field of a parent filter is on the object of its parent node, as CAB reads it (QueryEngine).
 */
export function usedFields(nodes: FileNode[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (object: unknown, field: unknown): void => {
    if (typeof object !== 'string' || !object) return;
    const set = out.get(object) ?? new Set<string>();
    if (typeof field === 'string' && PLAIN_FIELD.test(field)) set.add(field);
    out.set(object, set);
  };
  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  for (const n of nodes) {
    const object = n.fields.SObjectName__c;
    const lookupObject =
      n.fields.IsParentFilter__c === true ? byRef.get(n.parent ?? '')?.fields.SObjectName__c : object;
    add(object, undefined);
    add(lookupObject, n.fields.LookupFieldName__c);
    for (const f of n.filters) add(object, f.fields.FilterFieldAPIName__c);
    for (const d of n.dataInclusions) {
      add(object, d.fields.FieldAPIName__c);
      add(object, d.fields.SortFieldAPIName__c);
      for (const s of d.sorts) add(object, s.fields.SortFieldAPIName__c);
    }
  }
  return out;
}

/**
 * The class name that the target org uses. CAB stores the name with its namespace ("lb.Class") in an
 * org with the namespace. In an org without it (a CAB development org), the same class has no prefix.
 * A name without a prefix can be a customer class, so it never gets one.
 */
export function targetClassName(name: string, targetNs: string): string {
  const cabPrefix = 'lb.';
  return !targetNs && name.toLowerCase().startsWith(cabPrefix) ? name.slice(cabPrefix.length) : name;
}

export function usedClasses(nodes: FileNode[], targetNs = 'lb__'): string[] {
  return nodes
    .map((n) => n.fields.CustomFilterClassName__c)
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .map((c) => targetClassName(c, targetNs));
}

/**
 * Reads the field names of the given objects in the target, with describe. The Tooling API
 * `FieldDefinition` is not used, because it does not list the parts of compound fields, such as
 * Contact.MailingCountry and Contact.LastName. Field names are lower case.
 */
export async function loadTargetFields(cab: CabOrg, objects: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const existing = objects.filter((o) => cab.objectNames.has(o.toLowerCase()));
  await Promise.all(
    existing.map(async (object) => {
      const d = (await cab.conn.describe(object)) as unknown as { fields: Array<{ name: string }> };
      out.set(object.toLowerCase(), new Set(d.fields.map((f) => f.name.toLowerCase())));
    })
  );
  return out;
}

/** Reads which of the given Apex classes exist. A name "ns.Class" is checked with its namespace. */
export async function loadExistingClasses(cab: CabOrg, classNames: string[]): Promise<Set<string>> {
  const names = [...new Set(classNames)];
  if (!names.length) return new Set();
  const plain = names.map((n) => n.split('.').pop()!);
  const result = await cab.conn.query<{ Name: string; NamespacePrefix: string | null }>(
    `SELECT Name, NamespacePrefix FROM ApexClass WHERE Name IN (${plain
      .map((n) => `'${n.replace(/'/g, "\\'")}'`)
      .join(', ')})`
  );
  const found = new Set<string>();
  for (const r of result.records) {
    found.add(r.NamespacePrefix ? `${r.NamespacePrefix}.${r.Name}`.toLowerCase() : r.Name.toLowerCase());
  }
  return new Set(names.filter((n) => found.has(n.toLowerCase())));
}

/** 4.5: the objects, fields, and custom filter classes of a tree that do not exist in the target. */
export function treeProblems(
  nodes: FileNode[],
  targetObjects: Set<string>,
  targetFields: Map<string, Set<string>>,
  classes: Set<string>,
  ns: string
): TreeProblem[] {
  const problems: TreeProblem[] = [];
  for (const [object, fields] of usedFields(nodes)) {
    if (!targetObjects.has(object.toLowerCase())) {
      problems.push({ kind: 'object', object });
      continue;
    }
    const known = targetFields.get(object.toLowerCase());
    if (!known) continue;
    for (const field of fields) {
      // A CAB field in a filter has the namespace of the source org. Accept it with the target namespace too.
      if (!known.has(field.toLowerCase()) && !known.has(addNs(field, ns).toLowerCase()))
        problems.push({ kind: 'field', object, field });
    }
  }
  for (const className of new Set(usedClasses(nodes, ns)))
    if (!classes.has(className)) problems.push({ kind: 'class', className });
  return problems;
}
