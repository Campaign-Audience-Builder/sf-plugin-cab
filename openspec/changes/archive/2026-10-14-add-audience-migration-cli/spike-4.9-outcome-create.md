# Spike 4.9: create an outcome definition through REST

Date: 2026-10-14. Org: scratch org `cabplugin-s26`, with the `release/summer26` source of the cab repo (namespace `lb`).

## Question

Can the import create a missing outcome definition with REST inserts only, so that CAB measures it correctly? The CAB service `OutcomeDefinitionService.saveDefinitionVersioned` is not available through REST, and a REST insert does not run it.

## Method

1. The cab seed scripts `seed-b6-outcome-filters-1-records.apex` and `-2-config.apex` ran without change. Part 2 created the outcome definition "B6 Seed Completed Onboarding Task" with the CAB service.
2. The spike renamed the service-made definition, and then created a copy with the plugin code only (`convertTree`, `GraphBuilder`, `runNodes`). One Composite Graph had four nodes:
   - `POST AudienceFilterObject__c`: the template root (`IsTemplate__c`, `IsOutcomeTemplate__c`, no version).
   - `POST QueryFilter__c`: its condition.
   - `POST OutcomeDefinition__c`: the definition fields, and `OutcomeTemplateRoot__c` set to the new root.
   - `POST OutcomeDefinitionVersion__c`: version 1 with the snapshot fields of the source version, including `RootConfigJson__c`, and `OutcomeTemplateRoot__c` set to the new root.
3. The spike moved the assignment (`OutcomeDefinitionAssignment__c`) from the service-made definition to the REST copy.
4. The seed scripts `-3-cohorts.apex` and `-4-measure.apex` ran without change. Part 3 captured 17 cohorts through the real capture path. Part 4 evaluated the definition with `OutcomeDefinitionEvaluator` and then ran the real checkpoint engine (the tally).

## Result: it works

- CAB accepted all four inserts. No trigger or validation rule refused them.
- Part 3 found the REST copy as the listening outcome and captured all 17 cohorts.
- `OutcomeDefinitionEvaluator` evaluated the REST copy: in the proof cohort, 48 of 200 members completed the event, and 28 converted.
- The tally wrote 29 `OutcomeMeasurement__c` records for the REST copy, all with the status "Measured" and linked to the REST-made version. For example, cohort 2026-07-15: 28 of 200 treated members and 14 of 134 holdout members converted, at the checkpoints 7, 30, and 90.
- The service-made definition got no measurements after the assignment moved.

## Conditions for `--missing-outcomes create`

1. The export file must carry the snapshot of the latest version (`OutcomeDefinitionVersion__c` fields, including `RootConfigJson__c`). The current file format has only the definition fields and the template tree.
2. The importing user needs the permission set `OutcomeManagement` (create on `OutcomeDefinition__c` and `OutcomeDefinitionVersion__c`, and edit on `IsOutcomeTemplate__c`). The plan must check this, as it does for templates.
3. In this spike, `RootConfigJson__c` had no record Ids (`nodeId`, `outcomeDefinitionId`, and `aggregateChainStartNodeId` were null). A definition with child nodes or an outcome parameter can have Ids in this JSON. Such Ids would point to records of the source org. This is not tested.
4. The spike did not compare the full ladder with a run of the service-made definition. The treated rate (28 of 200, 14%) agrees with the 14% that part 1 of the seed designs. The holdout result (14 of 134) was not compared with an expected value.
5. The comment in `seed-b6-outcome-filters-2-config.apex` warns that a hand-built definition "is exactly the kind of near-miss that evaluates differently". The spike copied the records that the service wrote, so this risk applies only where the copy differs, for example condition 3.
