import { expect } from 'chai';
import { exportSkips, resolveSelection, Selectable, sequenceClosure } from '../../src/cab/selection.js';

const a = (
  id: string,
  name: string,
  apiName: string | null,
  folderPath: string | null = null,
  componentIds: string[] = []
): Selectable => ({
  id,
  name,
  apiName,
  folderPath,
  componentIds,
});

const audiences = [
  a('1', 'Leads DE', 'Leads_DE', 'Marketing/EMEA'),
  a('2', 'Leads AT', 'Leads_AT', 'Marketing/EMEA/Q4'),
  a('3', 'Q4 Waterfall', 'Q4_Waterfall', 'Marketing', ['1', '2']),
  a('4', 'Spring Promo', 'Spring_Promo_x3k9a', 'Sales'),
  a('5', 'Spring Promo', 'Spring_Promo_b7', 'Sales'),
  a('6', 'No Key', null, 'Sales'),
  a('7', 'Outer', 'Outer', null, ['3', '4']),
  a('8', 'Broken Seq', 'Broken_Seq', null, ['6']),
];
const byId = new Map(audiences.map((x) => [x.id, x]));
const folders = ['Marketing', 'Marketing/EMEA', 'Marketing/EMEA/Q4', 'Sales'];

describe('selection', () => {
  it('matches the API name first, with no regard to case', () => {
    const r = resolveSelection(audiences, { names: ['leads_de'] }, folders);
    expect([...r.ids]).to.deep.equal(['1']);
  });

  it('matches the name when no API name matches', () => {
    const r = resolveSelection(audiences, { names: ['Q4 Waterfall'] }, folders);
    expect([...r.ids]).to.deep.equal(['3']);
  });

  it('reports a name that matches two audiences, with their API names', () => {
    const r = resolveSelection(audiences, { names: ['Spring Promo'] }, folders);
    expect(r.ids.size).to.equal(0);
    expect(r.problems[0]).to.deep.include({ kind: 'ambiguous', value: 'Spring Promo' });
    expect((r.problems[0] as { matches: Array<{ apiName: string }> }).matches.map((m) => m.apiName)).to.have.members([
      'Spring_Promo_x3k9a',
      'Spring_Promo_b7',
    ]);
  });

  it('suggests three similar names when nothing matches', () => {
    const r = resolveSelection(audiences, { names: ['Leads CH'] }, folders);
    expect(r.problems[0].kind).to.equal('notFound');
    const similar = (r.problems[0] as { similar: string[] }).similar;
    expect(similar).to.have.length(3);
    expect(similar.slice(0, 2)).to.have.members(['Leads DE', 'Leads AT']);
  });

  it('selects a folder with its subfolders, and combines --name and --folder', () => {
    const r = resolveSelection(audiences, { folders: ['marketing/emea'], names: ['Outer'] }, folders);
    expect([...r.ids].sort()).to.deep.equal(['1', '2', '7']);
  });

  it('reports an unknown folder', () => {
    const r = resolveSelection(audiences, { folders: ['Marketing/APAC'] }, folders);
    expect(r.problems[0]).to.deep.include({ kind: 'folderNotFound' });
  });
});

describe('sequence closure', () => {
  it('adds the components at all levels and tells which sequence added them', () => {
    const c = sequenceClosure(byId, new Set(['7']));
    expect([...c.ids].sort()).to.deep.equal(['1', '2', '3', '4', '7']);
    expect(c.added.get('7')).to.have.members(['3', '1', '2', '4']);
    expect(c.cycles).to.deep.equal([]);
  });

  it('finds a cycle and skips its audiences', () => {
    const cyclic = new Map(byId);
    cyclic.set('1', a('1', 'Leads DE', 'Leads_DE', null, ['3']));
    const c = sequenceClosure(cyclic, new Set(['3']));
    expect(c.cycles).to.have.length(1);
    const skips = exportSkips(cyclic, c.ids, c.cycles);
    expect(skips.get('3')?.reason).to.equal('cycle');
  });
});

describe('export skips', () => {
  it('skips an audience without an API name and the sequence that uses it', () => {
    const c = sequenceClosure(byId, new Set(['8']));
    const skips = exportSkips(byId, c.ids, c.cycles);
    expect(skips.get('6')?.reason).to.equal('noApiName');
    expect(skips.get('8')).to.deep.include({ reason: 'usesSkipped', cause: '6' });
  });
});
