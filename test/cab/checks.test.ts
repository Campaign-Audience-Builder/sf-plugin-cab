import { expect } from 'chai';
import { treeProblems, usedFields } from '../../src/cab/checks.js';
import type { FileNode } from '../../src/cab/model.js';

function node(ref: string, parent: string | null, fields: Record<string, unknown>, filterFields: string[] = []): FileNode {
  return {
    ref,
    parent,
    aggregateChainStart: null,
    outcome: null,
    fields,
    filters: filterFields.map((f) => ({ fields: { FilterFieldAPIName__c: f } })),
    dataInclusions: [],
    templateReferences: [],
  } as unknown as FileNode;
}

// Contact -> CampaignMember (child filter) -> Campaign (parent filter), and Contact -> Account (parent filter).
const tree = [
  node('n1', null, { SObjectName__c: 'Contact', IsInitial__c: true }),
  node('n2', 'n1', { SObjectName__c: 'CampaignMember', LookupFieldName__c: 'ContactId', IsParentFilter__c: false }, [
    'Status',
  ]),
  node('n3', 'n2', { SObjectName__c: 'Campaign', LookupFieldName__c: 'CampaignId', IsParentFilter__c: true }),
  node('n4', 'n1', { SObjectName__c: 'Account', LookupFieldName__c: 'AccountId', IsParentFilter__c: true }, [
    'PersonMailingPostalCode',
  ]),
];

const sets = (m: Map<string, Set<string>>): Record<string, string[]> =>
  Object.fromEntries([...m].map(([o, f]) => [o, [...f].sort()]));

describe('field checks (4.5)', () => {
  it('reads the lookup field of a child filter from its own object', () => {
    expect(sets(usedFields(tree)).CampaignMember).to.deep.equal(['CampaignId', 'ContactId', 'Status']);
  });

  it('reads the lookup field of a parent filter from the object of its parent node', () => {
    expect(sets(usedFields(tree))).to.deep.equal({
      Contact: ['AccountId'],
      CampaignMember: ['CampaignId', 'ContactId', 'Status'],
      Campaign: [],
      Account: ['PersonMailingPostalCode'],
    });
  });

  it('blocks only on fields that the target does not have', () => {
    const objects = new Set(['contact', 'campaignmember', 'campaign', 'account']);
    const fields = new Map([
      ['contact', new Set(['accountid'])],
      ['campaignmember', new Set(['campaignid', 'contactid', 'status'])],
      ['campaign', new Set(['parentid'])],
      ['account', new Set(['name'])],
    ]);
    expect(treeProblems(tree, objects, fields, new Set(), 'lb__')).to.deep.equal([
      { kind: 'field', object: 'Account', field: 'PersonMailingPostalCode' },
    ]);
  });
});
