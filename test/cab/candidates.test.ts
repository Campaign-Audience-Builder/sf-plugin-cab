import { readFileSync } from 'node:fs';
import { expect } from 'chai';
import { CANDIDATE_OBJECTS, DEFINITION_OBJECTS, isDenied, referenceRule } from '../../src/cab/schema.js';

type Lookup = { field: string; type: string; referenceTo: string };
const fixture = JSON.parse(readFileSync(new URL('../fixtures/cab-lookups.json', import.meta.url), 'utf8')) as {
  refs: string[];
  lookups: Lookup[];
};

/**
 * Objects with a lookup into the definition that are not part of it: run state, schedules, results,
 * sync settings, and outcome measurements. Each entry needs a reason. A new CAB object with a lookup
 * into the definition makes this test fail until it is added to the candidate list or to this list.
 */
const OUTSIDE_THE_DEFINITION: Record<string, string> = {
  AudienceRun__c: 'run state',
  AudienceSchedule__c: 'schedule (non-goal)',
  AudienceScheduleTargetCampaign__c: 'scheduled action (non-goal)',
  AudienceMember__c: 'run results',
  AudienceSnapshotChunk__c: 'run results',
  CampaignMember: 'campaign members (non-goal)',
  SynchronizationSetting__c: 'final action (non-goal)',
  OutcomeCohort__c: 'outcome measurement',
  OutcomeMeasurement__c: 'outcome measurement',
  OutcomePeriodRollup__c: 'outcome measurement',
  OutcomeTimingFact__c: 'outcome measurement',
};

/** Lookups on definition objects to records outside the definition. The import clears them with a warning (D6). */
const CLEARED_WITH_WARNING = new Set([
  'AudienceDataInclusion__c.CampaignMemberFieldMapping__c',
  'AudienceDataInclusion__c.ExternalDataCollectionField__c',
]);

describe('candidate object list', () => {
  const definition = new Set<string>(DEFINITION_OBJECTS);
  const candidates = new Set<string>(CANDIDATE_OBJECTS);

  it(`covers every object with a lookup into the definition (${fixture.refs.join(', ')})`, () => {
    const uncovered = fixture.lookups
      .filter((l) => definition.has(l.referenceTo))
      .map((l) => l.field.split('.')[0])
      .filter((object) => !candidates.has(object) && !(object in OUTSIDE_THE_DEFINITION));
    expect(
      [...new Set(uncovered)],
      'add these objects to CANDIDATE_OBJECTS or to OUTSIDE_THE_DEFINITION'
    ).to.deep.equal([]);
  });

  it('has a reference rule for every lookup on a definition object', () => {
    const unhandled = fixture.lookups
      .filter((l) => definition.has(l.field.split('.')[0]))
      .filter((l) => {
        const [object, field] = l.field.split('.');
        return !referenceRule(object, field) && !isDenied(object, field) && !CLEARED_WITH_WARNING.has(l.field);
      })
      .map((l) => l.field);
    expect(unhandled, 'add a rule to REFERENCE_RULES, the deny-list, or CLEARED_WITH_WARNING').to.deep.equal([]);
  });
});
