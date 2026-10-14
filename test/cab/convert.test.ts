import { expect } from 'chai';
import { convertTree } from '../../src/cab/convert.js';
import { stableStringify } from '../../src/cab/json.js';
import type { RawTree } from '../../src/cab/read.js';
import { Schema, toObjectInfo } from '../../src/cab/schema.js';

type F = { name: string; type?: string; custom?: boolean; calculated?: boolean; autoNumber?: boolean; createable?: boolean; referenceTo?: string[] };
const describe_ = (name: string, fields: F[]) =>
  toObjectInfo(
    {
      name,
      keyPrefix: 'a00',
      createable: true,
      updateable: true,
      deletable: true,
      queryable: true,
      fields: [{ name: 'Id', type: 'id', custom: false, createable: false }, ...fields].map((f) => ({
        name: f.name,
        type: f.type ?? 'string',
        custom: f.custom ?? true,
        calculated: f.calculated ?? false,
        autoNumber: f.autoNumber ?? false,
        createable: f.createable ?? true,
        updateable: f.createable ?? true,
        referenceTo: f.referenceTo ?? [],
      })),
    },
    'lb__'
  );

export const schema: Schema = {
  ns: 'lb__',
  objects: new Map(
    [
      describe_('lb__AudienceFilterObject__c', [
        { name: 'Name', autoNumber: true, custom: false, createable: false },
        { name: 'lb__SObjectName__c' },
        { name: 'lb__IsInitial__c', type: 'boolean' },
        { name: 'lb__NumberOfFilters__c', calculated: true, type: 'double' },
        { name: 'lb__ParentAudienceFilterObject__c', type: 'reference', referenceTo: ['lb__AudienceFilterObject__c'] },
        { name: 'lb__AggregateChainStart__c', type: 'reference', referenceTo: ['lb__AudienceFilterObject__c'] },
        { name: 'lb__AudienceVersion__c', type: 'reference', referenceTo: ['lb__AudienceVersion__c'] },
        { name: 'OwnerId', type: 'reference', custom: false, referenceTo: ['User'] },
      ]),
      describe_('lb__QueryFilter__c', [
        { name: 'lb__FilterFieldAPIName__c' },
        { name: 'lb__Value__c' },
        { name: 'lb__ConditionNumber__c', type: 'double' },
        { name: 'lb__AudienceFilterObject__c', type: 'reference', referenceTo: ['lb__AudienceFilterObject__c'] },
      ]),
      describe_('lb__AudienceDataInclusion__c', [
        { name: 'lb__FieldAPIName__c' },
        { name: 'lb__AudienceFilterObject__c', type: 'reference', referenceTo: ['lb__AudienceFilterObject__c'] },
        { name: 'lb__AggregateQueryFilter__c', type: 'reference', referenceTo: ['lb__QueryFilter__c'] },
        { name: 'lb__CampaignMemberFieldMapping__c', type: 'reference', referenceTo: ['lb__CampaignMemberFieldMapping__c'] },
      ]),
    ].map((o) => [o.name, o])
  ),
};

/** A tree: root (Contact) with two children (Account, Case), filters, and a data inclusion. */
export function sampleTree(ids: (s: string) => string): RawTree {
  return {
    nodes: [
      { Id: ids('root'), SObjectName__c: 'Contact', IsInitial__c: true, ParentAudienceFilterObject__c: null, AudienceVersion__c: 'v1', NumberOfFilters__c: 2 },
      { Id: ids('case'), SObjectName__c: 'Case', IsInitial__c: false, ParentAudienceFilterObject__c: ids('root'), AggregateChainStart__c: ids('acct') },
      { Id: ids('acct'), SObjectName__c: 'Account', IsInitial__c: false, ParentAudienceFilterObject__c: ids('root') },
    ],
    filters: [
      { Id: ids('f2'), AudienceFilterObject__c: ids('root'), FilterFieldAPIName__c: 'LastName', Value__c: 'X', ConditionNumber__c: 2 },
      { Id: ids('f1'), AudienceFilterObject__c: ids('root'), FilterFieldAPIName__c: 'MailingCountry', Value__c: 'DE', ConditionNumber__c: 1 },
    ],
    dataInclusions: [
      { Id: ids('di'), AudienceFilterObject__c: ids('acct'), FieldAPIName__c: 'Name', AggregateQueryFilter__c: ids('f2'), CampaignMemberFieldMapping__c: 'a0X000000000001' },
    ],
    sorts: [],
    templateReferences: [],
  };
}

const keys = { template: () => null, outcome: () => null };

describe('file conversion', () => {
  it('has no Ids, no namespace, and local refs for self-lookups', () => {
    const nodes = convertTree(schema, sampleTree((s) => `id-${s}`), keys);
    const text = stableStringify(nodes);
    expect(text).not.to.match(/id-/);
    expect(text).not.to.include('lb__');
    expect(nodes.map((n) => n.fields.SObjectName__c)).to.deep.equal(['Contact', 'Account', 'Case']);
    const [root, acct, cas] = nodes;
    expect(root.parent).to.equal(null);
    expect(acct.parent).to.equal(root.ref);
    expect(cas.aggregateChainStart).to.equal(acct.ref);
    expect(root.filters.map((f) => f.fields.ConditionNumber__c)).to.deep.equal([1, 2]);
    expect(acct.dataInclusions[0].aggregateFilter).to.equal(root.filters[1].ref);
  });

  it('drops formula fields, auto-number names, and system lookups', () => {
    const [root] = convertTree(schema, sampleTree((s) => s), keys);
    expect(root.fields).to.have.keys(['SObjectName__c', 'IsInitial__c']);
  });

  it('records links to records outside the definition as cleared', () => {
    const nodes = convertTree(schema, sampleTree((s) => s), keys);
    expect(nodes[1].dataInclusions[0].clearedLinks).to.deep.equal(['CampaignMemberFieldMapping__c']);
  });

  it('gives the same file for the same tree with other Ids and another record order', () => {
    const one = convertTree(schema, sampleTree((s) => `org1-${s}`), keys);
    const t2 = sampleTree((s) => `org2-${s}`);
    t2.nodes.reverse();
    t2.filters.reverse();
    const two = convertTree(schema, t2, keys);
    expect(stableStringify(two)).to.equal(stableStringify(one));
  });
});
