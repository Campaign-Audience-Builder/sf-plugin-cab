import type { Connection } from '@salesforce/core';

/**
 * The objects that hold an audience definition, and the objects that the definition refers to.
 * This list is the only place that names CAB objects (D5). An object that is missing in an org is skipped.
 * Names are without the namespace prefix.
 */
export const DEFINITION_OBJECTS = [
  'Audience__c',
  'AudienceVersion__c',
  'AudienceSequenceComponent__c',
  'AudienceFilterObject__c',
  'QueryFilter__c',
  'AudienceDataInclusion__c',
  'IntermediateSortConfiguration__c',
  'AudienceFilterTemplateReference__c',
] as const;

/** Objects outside the definition that the plugin reads or creates. */
export const SUPPORT_OBJECTS = ['AudienceFolder__c', 'OutcomeDefinition__c', 'OutcomeDefinitionVersion__c', 'AudienceRun__c'] as const;

export const CANDIDATE_OBJECTS = [...DEFINITION_OBJECTS, ...SUPPORT_OBJECTS] as const;

export type CandidateObject = (typeof CANDIDATE_OBJECTS)[number];

/** Definition objects on which the importing user needs create, edit, and delete access. */
export const REQUIRED_DML_OBJECTS: CandidateObject[] = [
  'Audience__c',
  'AudienceVersion__c',
  'AudienceSequenceComponent__c',
  'AudienceFilterObject__c',
  'QueryFilter__c',
  'AudienceDataInclusion__c',
  'IntermediateSortConfiguration__c',
];

/**
 * Fields that are never exported or written (D5): run state, server-generated values, and
 * `LastConfigurationChange__c`, which the import sets itself. A plain name applies to every object.
 */
export const DENY_LIST = new Set([
  // run state
  'LastRun__c',
  'LastRunBy__c',
  'LastRunResults__c',
  'LatestPersistedRunId__c',
  'LastLimitExceptionDate__c',
  'RecurringScheduleIsRunning__c',
  'LatestRunDateTime__c',
  'Audience__c.ScheduledExecutionBlocked__c',
  'Audience__c.ScheduledExecutionBlockRun__c',
  'Audience__c.OutcomeNarration__c',
  'Audience__c.OutcomeNarratedAt__c',
  'AudienceVersion__c.AcceptedBaselineRun__c',
  'OutcomeDefinition__c.NarratedAt__c',
  'OutcomeDefinition__c.PerformanceNarration__c',
  // server-generated values
  'AudienceFilterTemplateReference__c.ReferenceKey__c',
  'AudienceVersion__c.HasOutcomeProvenance__c',
  'AudienceVersion__c.OutcomeProvenanceDefinitionIds__c',
  'AudienceFilterObject__c.HasParameters__c',
  'AudienceFilterObject__c.ParameterCount__c',
  'AudienceFolder__c.NumberOfStoredAudiences__c',
  'AudienceFolder__c.NumberOfSubfolders__c',
  // set by the import
  'LastConfigurationChange__c',
]);

export function isDenied(objectName: string, fieldName: string): boolean {
  return DENY_LIST.has(fieldName) || DENY_LIST.has(`${objectName}.${fieldName}`);
}

export type ReferenceRule =
  | { kind: 'internal' } // set from the structure of the definition (parent, version, audience)
  | { kind: 'local'; to: 'node' | 'filter' | 'dataInclusion'; as: string } // a `ref` inside one tree
  | { kind: 'key'; to: 'folder' | 'template' | 'outcome' | 'audience'; as: string }; // a stable key

/**
 * D6: how each known reference field is carried in the file. A reference field that is not here
 * and not on the deny-list is cleared with a warning.
 */
export const REFERENCE_RULES: Record<string, ReferenceRule> = {
  'Audience__c.AudienceFolder__c': { kind: 'key', to: 'folder', as: 'folder' },
  'Audience__c.LatestVersion__c': { kind: 'internal' },
  'AudienceVersion__c.Audience__c': { kind: 'internal' },
  'AudienceSequenceComponent__c.SequenceAudience__c': { kind: 'internal' },
  'AudienceSequenceComponent__c.Audience__c': { kind: 'key', to: 'audience', as: 'audience' },
  'AudienceFilterObject__c.AudienceVersion__c': { kind: 'internal' },
  'AudienceFilterObject__c.ParentAudienceFilterObject__c': { kind: 'local', to: 'node', as: 'parent' },
  'AudienceFilterObject__c.AggregateChainStart__c': { kind: 'local', to: 'node', as: 'aggregateChainStart' },
  'AudienceFilterObject__c.OutcomeDefinition__c': { kind: 'key', to: 'outcome', as: 'outcome' },
  'QueryFilter__c.AudienceFilterObject__c': { kind: 'internal' },
  'QueryFilter__c.AudienceVersion__c': { kind: 'internal' },
  'AudienceDataInclusion__c.AudienceFilterObject__c': { kind: 'internal' },
  'AudienceDataInclusion__c.ParentAudienceDataInclusion__c': { kind: 'local', to: 'dataInclusion', as: 'parent' },
  'AudienceDataInclusion__c.AggregateQueryFilter__c': { kind: 'local', to: 'filter', as: 'aggregateFilter' },
  'IntermediateSortConfiguration__c.AudienceDataInclusion__c': { kind: 'internal' },
  'IntermediateSortConfiguration__c.AudienceFilterObject__c': { kind: 'local', to: 'node', as: 'filterObject' },
  'AudienceFilterTemplateReference__c.AudienceFilterObject__c': { kind: 'internal' },
  'AudienceFilterTemplateReference__c.FilterTemplate__c': { kind: 'key', to: 'template', as: 'template' },
  'AudienceFolder__c.ParentFolder__c': { kind: 'internal' },
  'OutcomeDefinition__c.OutcomeTemplateRoot__c': { kind: 'internal' },
  'OutcomeDefinitionVersion__c.OutcomeDefinition__c': { kind: 'internal' },
  'OutcomeDefinitionVersion__c.OutcomeTemplateRoot__c': { kind: 'internal' },
};

export type FieldInfo = {
  /** Name without the namespace prefix. */
  name: string;
  /** API name in this org. */
  apiName: string;
  type: string;
  createable: boolean;
  updateable: boolean;
  calculated: boolean;
  autoNumber: boolean;
  custom: boolean;
  /** Referenced objects, without the namespace prefix. */
  referenceTo: string[];
};

export type ObjectInfo = {
  name: string;
  apiName: string;
  keyPrefix: string | null;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  queryable: boolean;
  fields: Map<string, FieldInfo>;
};

export type Schema = {
  /** `lb__` or an empty string. */
  ns: string;
  objects: Map<string, ObjectInfo>;
};

export function stripNs(name: string, ns: string): string {
  return ns && name.startsWith(ns) ? name.slice(ns.length) : name;
}

/** Adds the namespace to a custom object or field name. Standard names stay the same. */
export function addNs(name: string, ns: string): string {
  return ns && name.endsWith('__c') && !name.startsWith(ns) ? ns + name : name;
}

type DescribeField = {
  name: string;
  type: string;
  createable: boolean;
  updateable: boolean;
  calculated: boolean;
  autoNumber: boolean;
  custom: boolean;
  referenceTo?: string[] | null;
};

type DescribeResult = {
  name: string;
  keyPrefix: string | null;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  queryable: boolean;
  fields: DescribeField[];
};

export function toObjectInfo(describe: DescribeResult, ns: string): ObjectInfo {
  const fields = new Map<string, FieldInfo>();
  for (const f of describe.fields) {
    const name = stripNs(f.name, ns);
    fields.set(name, {
      name,
      apiName: f.name,
      type: f.type,
      createable: f.createable,
      updateable: f.updateable,
      calculated: f.calculated,
      autoNumber: f.autoNumber,
      custom: f.custom,
      referenceTo: (f.referenceTo ?? []).map((r) => stripNs(r, ns)),
    });
  }
  return {
    name: stripNs(describe.name, ns),
    apiName: describe.name,
    keyPrefix: describe.keyPrefix,
    createable: describe.createable,
    updateable: describe.updateable,
    deletable: describe.deletable,
    queryable: describe.queryable,
    fields,
  };
}

/** Describes the candidate objects that exist in the org. Missing objects are not in the result. */
export async function describeCandidates(conn: Connection, ns: string, existing: Set<string>): Promise<Schema> {
  const names = CANDIDATE_OBJECTS.map((o) => addNs(o, ns)).filter((o) => existing.has(o.toLowerCase()));
  const described = await Promise.all(names.map((n) => conn.describe(n) as unknown as Promise<DescribeResult>));
  const objects = new Map<string, ObjectInfo>();
  for (const d of described) {
    const info = toObjectInfo(d, ns);
    objects.set(info.name, info);
  }
  return { ns, objects };
}

/**
 * The fields of an object that carry the definition in the source org: custom fields and `Name`,
 * not calculated, not auto-number, not on the deny-list, and not a reference (references are
 * carried by the rules in REFERENCE_RULES).
 */
export function definitionFields(info: ObjectInfo): FieldInfo[] {
  return [...info.fields.values()]
    .filter((f) => (f.custom || f.name === 'Name') && !f.calculated && !f.autoNumber && f.createable)
    .filter((f) => !isDenied(info.name, f.name))
    .filter((f) => f.type !== 'reference')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reference fields of an object that are not on the deny-list and are custom (standard lookups such as OwnerId are system fields). */
export function referenceFields(info: ObjectInfo): FieldInfo[] {
  return [...info.fields.values()]
    .filter((f) => f.type === 'reference' && f.custom && !isDenied(info.name, f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function referenceRule(objectName: string, fieldName: string): ReferenceRule | undefined {
  return REFERENCE_RULES[`${objectName}.${fieldName}`];
}

/**
 * D5: a field is written only if it exists in both orgs, it is createable in the target, and it is not
 * on the deny-list. `fileFields` are the field names that the file has for this object.
 */
export function writableFields(target: ObjectInfo, fileFields: Iterable<string>): { write: string[]; missing: string[] } {
  const write: string[] = [];
  const missing: string[] = [];
  for (const name of fileFields) {
    const f = target.fields.get(name);
    if (!f || isDenied(target.name, name)) missing.push(name);
    else if (f.createable) write.push(name);
    else missing.push(name);
  }
  return { write: write.sort(), missing: missing.sort() };
}
