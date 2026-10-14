import { Connection, Messages, Org, SfError, StateAggregator } from '@salesforce/core';
import { describeCandidates, REQUIRED_DML_OBJECTS, Schema } from './schema.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'org');

export const API_VERSION = '62.0';

/** An org with CAB, as the commands see it. */
export type CabOrg = {
  org: Org;
  conn: Connection;
  /** The alias the admin gave, or the username. */
  alias: string;
  username: string;
  orgId: string;
  orgName: string;
  isSandbox: boolean;
  /** A scratch org or a trial org. These have an expiration date. */
  isScratch: boolean;
  /** CAB package version, for example "1.121.0", or null when CAB is not installed as a package. */
  cabVersion: string | null;
  schema: Schema;
  /** Lower-case API names of all objects in the org, from describe-global. */
  objectNames: Set<string>;
  /** Key prefix → object API name, from describe-global (D11). */
  keyPrefixes: Map<string, string>;
};

export function isProduction(org: Pick<CabOrg, 'isSandbox' | 'isScratch'>): boolean {
  return !org.isSandbox && !org.isScratch;
}

/** "Acme Corp (PRODUCTION)" or "Acme UAT (sandbox)". */
export function orgLabel(org: Pick<CabOrg, 'orgName' | 'isSandbox' | 'isScratch'>): string {
  if (isProduction(org)) return `${org.orgName} (PRODUCTION)`;
  return `${org.orgName} (${org.isSandbox ? 'sandbox' : 'scratch org'})`;
}

/** The org line of the plan screen: "Acme Corp (PRODUCTION) · admin@acme.com · CAB 1.121.0". */
export function orgLine(org: CabOrg): string {
  return [orgLabel(org), org.username, org.cabVersion ? `CAB ${org.cabVersion}` : 'CAB (not packaged)'].join(' · ');
}

type DescribeGlobal = { sobjects: Array<{ name: string; keyPrefix: string | null }> };

async function aliasFor(username: string): Promise<string | undefined> {
  try {
    const state = await StateAggregator.getInstance();
    return state.aliases.get(username) ?? undefined;
  } catch {
    return undefined;
  }
}

async function readCabVersion(conn: Connection, ns: string): Promise<string | null> {
  if (!ns) return null;
  try {
    const result = await conn.tooling.query<{
      SubscriberPackage: { NamespacePrefix: string };
      SubscriberPackageVersion: { MajorVersion: number; MinorVersion: number; PatchVersion: number };
    }>(
      'SELECT SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, ' +
        'SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion FROM InstalledSubscriberPackage'
    );
    const cab = result.records.find((r) => r.SubscriberPackage?.NamespacePrefix === ns.replace(/__$/, ''));
    if (!cab) return null;
    const v = cab.SubscriberPackageVersion;
    return `${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion}`;
  } catch {
    // Without access to the Tooling API, the version is unknown. This is not an error.
    return null;
  }
}

/** Finds the CAB namespace from the objects in the org: `lb__Audience__c`, then `Audience__c`. */
export function detectNamespace(objectNames: Set<string>): string | undefined {
  if (objectNames.has('lb__audience__c')) return 'lb__';
  if (objectNames.has('audience__c')) return '';
  return undefined;
}

/** Connects to an org and reads its CAB schema. Stops with a clear message if CAB is not installed. */
export async function connectCab(org: Org, givenAlias?: string): Promise<CabOrg> {
  const conn = org.getConnection(API_VERSION);
  const username = org.getUsername() ?? conn.getUsername() ?? '';
  const alias = givenAlias ?? (await aliasFor(username)) ?? username;
  const [global, orgRecord] = await Promise.all([
    conn.describeGlobal() as unknown as Promise<DescribeGlobal>,
    conn.singleRecordQuery<{ Id: string; Name: string; IsSandbox: boolean; TrialExpirationDate: string | null }>(
      'SELECT Id, Name, IsSandbox, TrialExpirationDate FROM Organization'
    ),
  ]);
  const objectNames = new Set(global.sobjects.map((s) => s.name.toLowerCase()));
  const keyPrefixes = new Map<string, string>();
  for (const s of global.sobjects) if (s.keyPrefix) keyPrefixes.set(s.keyPrefix, s.name);

  const ns = detectNamespace(objectNames);
  if (ns === undefined) {
    throw new SfError(messages.getMessage('error.notInstalled', [orgRecord.Name]), 'CabNotInstalled', [
      messages.getMessage('error.notInstalled.action', [alias]),
    ]);
  }
  const [schema, cabVersion] = await Promise.all([describeCandidates(conn, ns, objectNames), readCabVersion(conn, ns)]);
  return {
    org,
    conn,
    alias,
    username,
    orgId: orgRecord.Id,
    orgName: orgRecord.Name,
    isSandbox: orgRecord.IsSandbox,
    isScratch: !orgRecord.IsSandbox && Boolean(orgRecord.TrialExpirationDate),
    cabVersion,
    schema,
    objectNames,
    keyPrefixes,
  };
}

export type AccessProblem = { object: string; missing: Array<'create' | 'edit' | 'delete' | 'read'> };

/** 2.4: checks create, edit, and delete access on the definition objects for the running user. */
export function checkDmlAccess(schema: Schema): AccessProblem[] {
  const problems: AccessProblem[] = [];
  for (const name of REQUIRED_DML_OBJECTS) {
    const info = schema.objects.get(name);
    if (!info) {
      // Describe does not show an object that the user cannot read.
      problems.push({ object: name, missing: ['read', 'create', 'edit', 'delete'] });
      continue;
    }
    const missing: AccessProblem['missing'] = [];
    if (!info.createable) missing.push('create');
    if (!info.updateable) missing.push('edit');
    if (!info.deletable) missing.push('delete');
    if (missing.length) problems.push({ object: name, missing });
  }
  return problems;
}

export function accessError(org: CabOrg, problems: AccessProblem[]): SfError {
  const lines = problems.map((p) => `${p.object}: no ${p.missing.join(', ')} access`);
  return new SfError(
    messages.getMessage('error.access', [org.username, org.orgName, lines.join('\n  ')]),
    'MissingPermission',
    [messages.getMessage('error.access.action', [org.username, org.alias])]
  );
}
