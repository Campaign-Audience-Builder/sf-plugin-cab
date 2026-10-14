import { Org } from '@salesforce/core';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import AudienceExport from '../../src/commands/cab/audience/export.js';
import AudienceList from '../../src/commands/cab/audience/list.js';

describe('command flags', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);
  });

  afterEach(() => {
    $$.restore();
  });

  it('rejects --all together with --name', async () => {
    try {
      await AudienceExport.run(['-o', testOrg.username, '--all', '--name', 'Leads_DE']);
      expect.fail('expected an error');
    } catch (error) {
      expect((error as Error).message).to.match(/--name|--all/);
    }
  });

  it('names the login command when the org is unknown', async () => {
    $$.SANDBOX.stub(Org, 'create').rejects(new Error('NamedOrgNotFoundError'));
    try {
      await AudienceList.run(['-o', 'unknown-alias']);
      expect.fail('expected an error');
    } catch (error) {
      const err = error as Error & { actions?: string[] };
      expect(err.message).to.include('unknown-alias');
      expect(err.actions?.join('\n')).to.include('sf org login web --alias unknown-alias');
    }
  });
});
