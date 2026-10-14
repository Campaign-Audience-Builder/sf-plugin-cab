import { expect } from 'chai';
import { runNodes } from '../../src/cab/composite.js';
import { convertTree } from '../../src/cab/convert.js';
import { addTree, GraphBuilder } from '../../src/cab/graph.js';
import { exitCodeOf } from '../../src/cab/importFlow.js';
import { translateError } from '../../src/cab/importer.js';
import type { FileAudience } from '../../src/cab/model.js';
import { hashAudience } from '../../src/cab/normalize.js';
import type { CabOrg } from '../../src/cab/org.js';
import { AudiencePlan, countGraphNodes, orderAudiences } from '../../src/cab/plan.js';
import { definitionFields } from '../../src/cab/schema.js';
import { sampleTree, schema } from './convert.test.js';

const keys = { template: () => null, outcome: () => null };
const target = { schema, objectNames: new Set<string>() } as unknown as CabOrg;

function audience(apiName: string, ids: (s: string) => string, components: string[] = []): FileAudience {
  return {
    apiName,
    folder: 'Marketing',
    fields: { Name: apiName },
    version: { fields: {} },
    components: components.map((c, i) => ({ audience: c, fields: { Order__c: i + 1 } })),
    tree: convertTree(schema, sampleTree(ids), keys),
  };
}

const allowed = (o: string): Set<string> | undefined => {
  const info = schema.objects.get(o);
  return info ? new Set(definitionFields(info).map((f) => f.name)) : undefined;
};

describe('change detection (D9)', () => {
  const opts = { allowed, keepRef: () => true, compareFolder: true };

  it('gives the same hash for the same audience from two orgs', () => {
    expect(
      hashAudience(
        audience('Leads_DE', (s) => `a-${s}`),
        opts
      )
    ).to.equal(
      hashAudience(
        audience('leads_de', (s) => `b-${s}`),
        opts
      )
    );
  });

  it('gives another hash when a filter value changes', () => {
    const changed = audience('Leads_DE', (s) => s);
    changed.tree[0].filters[0].fields.Value__c = 'AT';
    expect(hashAudience(changed, opts)).not.to.equal(
      hashAudience(
        audience('Leads_DE', (s) => s),
        opts
      )
    );
  });

  it('ignores fields that the target does not have', () => {
    const withExtra = audience('Leads_DE', (s) => s);
    withExtra.tree[1].fields.NewField__c = 'x';
    expect(hashAudience(withExtra, opts)).to.equal(
      hashAudience(
        audience('Leads_DE', (s) => s),
        opts
      )
    );
  });
});

describe('graph builder (D8)', () => {
  it('posts parents before children, and refers only to earlier nodes', () => {
    const g = new GraphBuilder(target, '62.0');
    addTree(g, audience('X', (s) => s).tree, {
      prefix: 'n',
      version: 'a0V000000000001',
      label: 'X',
      outcomeId: () => undefined,
      templateRefTarget: () => undefined,
    });
    g.delete('del1', 'AudienceFilterObject__c', 'a0F000000000009', 'X: old');
    const { nodes } = g.build();
    const seen = new Set<string>();
    for (const node of nodes) {
      const refs = [...JSON.stringify(node).matchAll(/@\{([A-Za-z0-9_]+)\.id\}/g)].map((m) => m[1]);
      for (const r of refs) expect(seen.has(r), `${node.referenceId} refers to ${r}`).to.equal(true);
      seen.add(node.referenceId);
    }
    expect(nodes[nodes.length - 1].method).to.equal('DELETE');
    expect(nodes[0].body).to.deep.include({ lb__SObjectName__c: 'Contact', lb__AudienceVersion__c: 'a0V000000000001' });
    expect(nodes[0].url).to.equal('/services/data/v62.0/sobjects/lb__AudienceFilterObject__c');
  });
});

describe('graph runner', () => {
  it('sends large node lists in several graphs and puts the Ids of earlier graphs into later nodes', async () => {
    const sent: string[] = [];
    let n = 0;
    const conn = {
      getApiVersion: () => '62.0',
      request: (req: { body: string }) => {
        sent.push(req.body);
        const graph = JSON.parse(req.body) as { graphs: Array<{ compositeRequest: Array<{ referenceId: string }> }> };
        const compositeResponse = graph.graphs[0].compositeRequest.map((r) => ({
          referenceId: r.referenceId,
          httpStatusCode: 201,
          body: { id: `id${++n}` },
        }));
        return Promise.resolve({
          graphs: [{ graphId: 'g1', isSuccessful: true, graphResponse: { compositeResponse } }],
        });
      },
    };
    const nodes = [
      { method: 'POST' as const, url: '/x', referenceId: 'a', body: {} },
      { method: 'POST' as const, url: '/x', referenceId: 'b', body: { parent: '@{a.id}' } },
    ];
    const result = await runNodes(conn as never, nodes, 1);
    expect(result.ok).to.equal(true);
    expect(result.graphs).to.equal(2);
    expect(sent[1]).to.include('"parent":"id1"');
  });

  it('retries a graph one time after UNABLE_TO_LOCK_ROW', async () => {
    let calls = 0;
    const conn = {
      getApiVersion: () => '62.0',
      request: () => {
        calls++;
        const ok = calls > 1;
        return Promise.resolve({
          graphs: [
            {
              graphId: 'g1',
              isSuccessful: ok,
              graphResponse: {
                compositeResponse: [
                  {
                    referenceId: 'a',
                    httpStatusCode: ok ? 201 : 400,
                    body: ok ? { id: 'x' } : [{ errorCode: 'UNABLE_TO_LOCK_ROW', message: 'locked' }],
                  },
                ],
              },
            },
          ],
        });
      },
    };
    const result = await runNodes(conn as never, [{ method: 'POST', url: '/x', referenceId: 'a', body: {} }]);
    expect(calls).to.equal(2);
    expect(result.ok).to.equal(true);
  });
});

describe('import order (4.6) and node count (4.7)', () => {
  const plan = (apiName: string, deps: string[]): AudiencePlan =>
    ({ entry: { apiName }, fileDependencies: deps } as unknown as AudiencePlan);

  it('puts components before the sequences that use them', () => {
    const ordered = orderAudiences([plan('Outer', ['Q4']), plan('Q4', ['DE', 'AT']), plan('AT', []), plan('DE', [])]);
    const names = ordered.map((a) => a.entry.apiName);
    expect(names.indexOf('DE')).to.be.lessThan(names.indexOf('Q4'));
    expect(names.indexOf('AT')).to.be.lessThan(names.indexOf('Q4'));
    expect(names.indexOf('Q4')).to.be.lessThan(names.indexOf('Outer'));
  });

  it('counts audience, version, components, old tree deletes, and new records', () => {
    const a = audience('X', (s) => s, ['A', 'B']);
    // 2 (patch audience + version) + 2 components + 1 removed + 4 old nodes + 3 nodes + 2 filters + 1 data inclusion
    expect(countGraphNodes(a, { update: true, oldTreeSize: 4, oldComponents: 3, templateReferences: 0 })).to.equal(15);
    // 3 (audience, version, link) + 2 components + 3 nodes + 2 filters + 1 data inclusion
    expect(countGraphNodes(a, { update: false, oldTreeSize: 0, oldComponents: 0, templateReferences: 0 })).to.equal(11);
  });
});

describe('messages and exit codes', () => {
  it('names the record, the field, and the Salesforce text, with no Ids', () => {
    const info = new Map([['nf1', { object: 'QueryFilter__c', what: 'Leads DE: filter MailingCountry' }]]);
    const text = translateError(
      'Leads DE',
      {
        referenceId: 'nf1',
        errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION',
        message: 'Bad value for a0F5g00000ABCDEFGH',
        fields: ['lb__Value__c'],
      },
      info,
      'lb__',
      false
    );
    expect(text).to.equal(
      'Salesforce rejected the filter MailingCountry (Value__c): Bad value for <Id> [FIELD_CUSTOM_VALIDATION_EXCEPTION]'
    );
  });

  it('exits with 0, 1, and 68', () => {
    const c = { created: 0, updated: 0, unchanged: 0, blocked: 0, failed: 0, skipped: 0, notProcessed: 0 };
    expect(exitCodeOf({ ...c, created: 509, unchanged: 3 })).to.equal(0);
    expect(exitCodeOf({ ...c, created: 509, failed: 3 })).to.equal(68);
    expect(exitCodeOf({ ...c, blocked: 2, unchanged: 1 })).to.equal(1);
  });
});
