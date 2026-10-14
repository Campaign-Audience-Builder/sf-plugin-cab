import { expect } from 'chai';
import { matchLibrary } from '../../src/cab/library.js';
import type { FileTemplateReference } from '../../src/cab/model.js';
import { Answers, LibraryItem, Plan, writesTemplateReference } from '../../src/cab/plan.js';
import type { Raw } from '../../src/cab/read.js';
import type { FileTemplate } from '../../src/cab/model.js';

const raw = (id: string, values: Record<string, unknown>): Raw => ({ Id: id, ...values });

describe('library matching (D6, D12)', () => {
  const targets = [
    raw('a1', { UniqueName__c: 'Active_Customers', Label__c: 'Active Customers' }),
    raw('a2', { Label__c: 'Opted-in Contacts' }),
    raw('a3', { Label__c: 'Duplicate' }),
    raw('a4', { Label__c: 'duplicate' }),
  ];

  it('matches by UniqueName__c first', () => {
    expect(matchLibrary({ key: 'active_customers', name: 'Other label' }, targets, 'Label__c', true)).to.deep.equal({
      status: 'matched',
      targetId: 'a1',
      by: 'uniqueName',
    });
  });

  it('matches by name when the name is unique', () => {
    expect(matchLibrary({ key: 'x', name: 'Opted-in Contacts' }, targets, 'Label__c', true)).to.deep.include({
      status: 'matched',
      targetId: 'a2',
    });
  });

  it('counts two records with the same name as no match, and names them', () => {
    const m = matchLibrary({ key: 'x', name: 'Duplicate' }, targets, 'Label__c', false);
    expect(m).to.deep.equal({ status: 'ambiguous', names: ['Duplicate', 'duplicate'] });
  });

  it('reports a missing record', () => {
    expect(matchLibrary({ key: 'x', name: 'Nope' }, targets, 'Label__c', true)).to.deep.equal({ status: 'missing' });
  });
});

describe('template links', () => {
  const item = (status: 'matched' | 'missing', cannotCreate?: string): LibraryItem<FileTemplate> => ({
    entry: { key: 'T', name: 'T', tree: [] },
    match: status === 'matched' ? { status, targetId: 'a1', by: 'name' } : { status },
    differs: false,
    otherUses: 0,
    cannotCreate,
  });
  const plan = (
    canCreate: boolean,
    t: LibraryItem<FileTemplate>
  ): Pick<Plan, 'canCreateTemplateReferences' | 'templates'> => ({
    canCreateTemplateReferences: canCreate,
    templates: new Map([['T', t]]),
  });
  const answers = (templates: Answers['templates']): Answers => ({
    folders: 'create',
    templates,
    outcomes: 'create',
    templateDefaults: 'clear',
  });
  const link = (mode: string): FileTemplateReference => ({ template: 'T', fields: { ReferenceMode__c: mode } });

  it('writes a Synced link to a template that exists', () => {
    expect(writesTemplateReference(plan(true, item('matched')), link('Synced'), answers('skip'))).to.equal(true);
  });

  it('writes a Synced link to a template that the import creates', () => {
    expect(writesTemplateReference(plan(true, item('missing')), link('Synced'), answers('create'))).to.equal(true);
  });

  it('never writes a Locked link, because CAB refuses it outside its own service', () => {
    expect(writesTemplateReference(plan(true, item('matched')), link('Locked'), answers('create'))).to.equal(false);
  });

  it('writes no link when the user cannot create links, or when the template is skipped or cannot be created', () => {
    expect(writesTemplateReference(plan(false, item('matched')), link('Synced'), answers('create'))).to.equal(false);
    expect(writesTemplateReference(plan(true, item('missing')), link('Synced'), answers('skip'))).to.equal(false);
    expect(
      writesTemplateReference(plan(true, item('missing', 'no permission')), link('Synced'), answers('create'))
    ).to.equal(false);
  });
});
