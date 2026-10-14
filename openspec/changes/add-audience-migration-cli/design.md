## Context

See proposal.md for the reason for this change. These facts about CAB shape the design:

- The definition of an audience is stored in these objects: `Audience__c`, `AudienceVersion__c`, `AudienceSequenceComponent__c`, `AudienceFilterObject__c`, `QueryFilter__c`, `AudienceDataInclusion__c`, `IntermediateSortConfiguration__c`, and, from summer26, `AudienceFilterTemplateReference__c`. Subscriber orgs see them with the namespace `lb__`.
- `AudienceAPIName__c` is unique and case-insensitive, but it is not an external Id. Thus a REST upsert by API name is not possible. The field is not required, and the CAB UI fills it with a random suffix.
- Schedules, runs, campaign members, and scheduled actions point to `AudienceVersion__c` and `AudienceSequenceComponent__c`. These records must keep their Ids.
- `AudienceFilterObject__c.AudienceVersion__c` and `ParentAudienceFilterObject__c` are lookups with "set null" on delete. A delete of the root or of the audience does not delete child filter objects. `QueryFilter__c` and `AudienceDataInclusion__c` are master-detail children of the filter object, and `IntermediateSortConfiguration__c` is a master-detail child of the data inclusion. A delete of a filter object deletes them too.
- A spike on 2026-10-14 confirmed these Composite Graph facts:
  - One graph can update the audience and version, create a new tree with references to earlier nodes, and delete the old tree.
  - If one node fails, the graph rolls back all nodes.
  - A node can only refer to an earlier node.
  - sObject Collections requests are not allowed in a graph. Each delete needs its own node.
- `sf org display --json` hides the access token. A plugin gets the connection from `@salesforce/core` and does not need the token.

## Goals / Non-Goals

**Goals:**
- An admin who knows Salesforce but not this tool completes a first migration with `--help` and the prompts only.
- The plan screen answers three questions before any change: Which org? What changes? What is wrong?
- A failed or stopped import never leaves a half-written audience, and the same command completes it.

**Non-Goals:**
- Schedules, scheduled actions, final actions, run results, and campaign members.
- Deletion of target audiences that are not in the file. No `--prune` flag in version 1.
- Updates of Filter Library templates and outcome definitions that exist in the target. The import creates missing ones, but it never changes existing ones.
- Mapping of record Ids in filter values. Version 1 only warns.
- A graphical UI or an AppExchange component.

## Decisions

### D1. sf CLI plugin with the topic `cab audience`

The tool is an oclif plugin built on `@salesforce/sf-plugins-core`. Admins already have the sf CLI. The plugin gets org auth, `--target-org`, `--json`, and the standard help layout from the framework.

Alternatives: a standalone npm script that calls `sf` as a subprocess. It must parse CLI output and cannot get the access token. A packaged Apex endpoint was rejected because it needs a CAB release and a security review for each change.

### D2. Command tree

```
sf cab audience list     -o <org> [--folder <path>]...
sf cab audience export   -o <org> (--all | --name <n>... | --folder <path>...) [--output-file <f>] [--overwrite]
sf cab audience import   -o <org> --file <f> [--dry-run] [--yes] [--fail-fast]
                         [--missing-folders create|skip|fail] [--missing-templates create|skip|fail] [--missing-outcomes create|skip|fail]
sf cab audience migrate  --source-org <a> --target-org <b> (selection flags) (import flags) [--output-file <f>]
```

Shared flags: `--json`, `--verbose`.

The verbs follow what admins know from Data Loader and from `sf project deploy`: list, export, import. `migrate` covers the frequent case and keeps the export file, so the two-step path stays available. A separate `diff` command was rejected, because `import --dry-run` shows the same information in the same form as the real run.

Short flags: `-o` (org), `-f` (file), `-n` (name), `-d` (dry run), `-y` (yes). `--folder` uses the path that the CAB UI shows, with `/` as the separator, for example `"Marketing/EMEA"`.

### D3. One plan screen, one confirmation

The import collects all checks first and shows them as one screen. The admin answers once. Questions that need an answer, such as missing folders, come before the final confirmation and are part of the same screen:

```
$ sf cab audience import -o prod -f golive.json

Target   Acme Corp (PRODUCTION) · admin@acme.com · CAB 1.121.0
File     golive.json · 512 audiences from Acme UAT (sandbox) · 2026-10-14 14:05

Plan
  498  create
   11  update
    3  unchanged (skipped)
    2  blocked
   20  audiences in Acme Corp are not in the file and stay unchanged

Blocked
  ✗ Spring Promo (Spring_Promo_x3k9a)
      Field Contact.Region__c does not exist in Acme Corp. Deploy it first.
  ✗ Q4 Waterfall (Q4_Waterfall)
      Uses Spring Promo, which is blocked.

Warnings
  ! 3 filters use record Ids that can differ in this org        (details: --verbose)
  ! Webinar Leads: not linked to Filter Library template "Active Customers"

3 folders do not exist in Acme Corp:
  Marketing/EMEA/Q4 Campaigns
  Sales/Webinars
? Create these folders? Without them, 7 audiences are imported without a folder. (Y/n)

2 Filter Library templates do not exist in Acme Corp:
  Active Customers, Opted-in Contacts
? Create these templates? Without them, 9 audiences are imported without the template link. (Y/n)

Backup of the 11 updated audiences: ./cab-backup-prod-20261014-1412.json
? Import 509 audiences into Acme Corp (PRODUCTION)? (y/N)
```

Rules for this screen:
- Numbers come first. Lists come after the numbers and are limited to 10 lines per section. `--verbose` shows all lines.
- The final confirmation repeats the org name and "PRODUCTION". Its default is "no".
- The questions for missing folders, templates, and outcome definitions default to "yes". They only add records that the imported audiences need. They never change records that exist in the target.

During the import, one progress line shows `Importing 123/509 · Webinar Leads`. At the end, the summary shows the numbers, the failed audiences, the report path, and the backup path. If a failure occurred, it also shows the restore command.

### D4. Interactive selection when no selection flag is given

`export` and `migrate` without `--all`, `--name`, or `--folder` open a searchable checkbox list grouped by folder. Selection of a folder selects all of its audiences. This helps the admin who does not know API names. Prompts use `@inquirer/prompts`, the library that the sf CLI also uses. In a non-interactive run, the command stops and names the selection flags (see the cli-interaction spec).

### D5. Schema from describe, with a short rule list

For each candidate object, the plugin calls describe in both orgs. It writes a field only if all of these conditions are true:
1. The field exists in both orgs.
2. The field is `createable` in the target.
3. The field is not on the deny-list.

The deny-list holds:
- run-state fields: `LastRun__c`, `LastRunBy__c`, `LastRunResults__c`, `LatestPersistedRunId__c`, `LastLimitExceptionDate__c`, `RecurringScheduleIsRunning__c`, `LatestRunDateTime__c`
- server-generated keys: `AudienceFilterTemplateReference__c.ReferenceKey__c`
- `LastConfigurationChange__c`, which the import sets to the current time on each written version

Formula and roll-up fields drop out at step 2, so they need no list.

The namespace is found from the org: the plugin checks for `lb__Audience__c`, and then for `Audience__c` in an unpackaged dev org. The admin never gives a namespace.

The candidate object list is the only place that names objects. An object missing in an org is skipped (see the specs).

### D6. Reference rules

| Reference | Rule |
|---|---|
| To an object inside the definition | Replaced by a graph reference (`@{node.id}`), or by the kept target Id for version and sequence components |
| `Audience__c.AudienceFolder__c` | Resolved by folder `UniqueName__c`. Missing folders follow `--missing-folders`. |
| `AudienceSequenceComponent__c.Audience__c` | Resolved by API name, in the file or in the target |
| Filter Library template (`FilterTemplate__c`) | Resolved by `UniqueName__c`, then by a unique name match. If missing: created, or cleared with a warning, by `--missing-templates` (D12) |
| `OutcomeDefinition__c` | Resolved by `UniqueName__c`, then by a unique name match. If missing: created by `--missing-outcomes` (D12), else the audience is blocked. Without the link, an outcome filter cannot work. |
| User lookups, run lookups | On the deny-list, or cleared |
| Any other reference | Cleared, with a warning that names the object and field |

The last rule makes a new CAB lookup safe without a plugin update. The result is a warning, never a wrong Id.

### D7. Export file format

The export file is one JSON file with sorted keys and two-space indentation, so that `git diff` shows real changes only:

```json
{
  "format": "cab-audiences/1",
  "exportedAt": "2026-10-14T14:05:12Z",
  "plugin": "sf-plugin-cab 1.0.0",
  "source": { "org": "Acme UAT", "orgId": "00D...", "isSandbox": true, "cabVersion": "1.121.0" },
  "folders": [ { "uniqueName": "Marketing", "label": "Marketing", "parent": null } ],
  "templates": [ { "key": "Active_Customers", "fields": { "Label__c": "Active Customers" }, "tree": [ ] } ],
  "outcomeDefinitions": [ { "key": "Purchase_30d", "fields": { "Name": "Purchase within 30 days" }, "tree": [ ] } ],
  "audiences": [
    {
      "apiName": "Leads_DE",
      "folder": "Marketing",
      "fields": { "Name": "Leads DE", "Type__c": "Standard", "InitialObject__c": "Contact" },
      "version": { "fields": { "BatchSize__c": 200 } },
      "components": [],
      "tree": [
        { "ref": "n1", "parent": null, "fields": { "SObjectName__c": "Contact", "IsInitial__c": true },
          "filters": [ { "fields": { "FilterFieldAPIName__c": "MailingCountry", "Operator__c": "=", "Value__c": "DE" } } ],
          "dataInclusions": [], "templateRef": null }
      ]
    }
  ]
}
```

Field names in the file have no namespace prefix. The plugin adds the prefix of each org. `ref` values are local to one audience, and they encode the self-lookups (`parent`, `aggregateChainStart`). `format` has a major version. The plugin refuses a newer major version with "Update the plugin: sf plugins update".

### D8. Write path: one Composite Graph per audience

For each audience, in sequence order, the plugin builds one graph:
1. `PATCH` or `POST` the audience.
2. `PATCH` or `POST` the version.
3. `PATCH` or `POST` the sequence components, and `DELETE` the removed components.
4. `DELETE` each old filter object.
5. `POST` the new filter objects, parents first, then their filters, data inclusions, sort configurations, and template references.

The plugin queries the target Ids before it builds the graphs. If an audience needs more than 500 nodes, the plugin writes it in several requests: create the new records first, then delete the old records. The plan marks such an audience as "large: not atomic" (see the import spec).

Imports run one audience at a time. The `Audience__c` trigger updates the folder record on each insert. Parallel graphs into one folder can therefore fail with `UNABLE_TO_LOCK_ROW`. The plugin retries a graph one time after a lock error.

### D9. Change detection

The plugin normalizes each audience to the file form and computes a hash for each side, from the source file and from the target. The normalized form has no Ids, has sorted fields, and has the tree in a stable order. Equal hashes mean "unchanged", so there is no write. Thus a second run is fast, and the cache of unchanged audiences stays valid.

### D10. Backup and report files

The backup is an export of the target audiences that the import will update, made just before the first write. It uses the export format, so the restore is a normal import of the backup file. The report is a JSON file with one entry for each audience: status, reason, and target Id. Both files are written next to the import file and have the target alias and a time stamp in their names.

### D11. Id-like values

The export checks each filter value. A value is flagged if it is 15 or 18 characters long, matches the Salesforce Id pattern, and starts with a key prefix of an object in the source org. The plugin reads the key prefixes with one describe-global call. The check only warns.

### D12. Create missing templates and outcome definitions, never update them

The export stores each used template and outcome definition one time, with its filter tree (D7). On import, a missing record is created when the admin agrees. The plugin creates these records before the first audience that uses them, each in its own graph. An existing record is never changed, also when it differs from the file. Two reasons apply:
- An update of a template goes to every target audience that uses it in Locked or Synced mode, not only to the imported audiences.
- An outcome definition keeps immutable version snapshots. A changed definition gives a new version and changes how CAB measures existing cohorts.

A template is a filter tree with `IsTemplate__c = true` and no audience version. The tree-copy logic of D8 creates it.

An outcome definition is more complex. It has a template tree (`OutcomeTemplateRoot__c`) and `OutcomeDefinitionVersion__c` snapshots. There is no trigger on `OutcomeDefinition__c`. Apex service code creates the versions, and a REST insert does not run that code. Task 4.10 is a spike that creates a definition through REST in a summer26 org and runs a tally. If the definition works, `--missing-outcomes create` stays in version 1. If it does not work, version 1 offers only `skip` and `fail` for outcome definitions, and the plan tells the admin to create the definition in the target UI first. The specs do not change in either case, except that `create` becomes unavailable.

Alternative: never create, link only. This was rejected because a go-live into an empty org then blocks every audience that uses a template or an outcome.

## Risks / Trade-offs

- [A sequence over several audiences is not atomic as a whole] → The import order (components first) and dependent skips keep sequences consistent. The same command completes a stopped import.
- [Audiences created separately in two orgs have different API names (random suffix), so the import creates duplicates] → The plan shows "create" counts before any change. The `list` command shows API names in both orgs. The docs explain the go-live into an empty org as the main case.
- [A filter value with an org-specific Id gives a wrong audience in the target] → The export and import warn with the audience and field. Id mapping is a non-goal for version 1.
- [Unsigned plugin install prompt makes admins doubt the tool] → The npm package is signed, and the README shows the publisher and the verification step.
- [A new CAB object in the definition is not on the candidate list] → The import still works, but the new object is not copied. A CAB release checklist item asks for the plugin update. A test compares the candidate list with the CAB object graph.
- [A created outcome definition has no version snapshot and fails at its first tally] → The spike in task 4.10 decides if `create` is offered for outcome definitions.
- [An import into production during a run] → The run-in-progress check blocks the audience. Runs that start after the check can still read a mix of old and new records. Each graph is atomic, so a run sees either the old or the new tree.

## Migration Plan

Not applicable. This is a new tool with no existing users. Releases go to npm as `@campaign-audience-builder/sf-plugin-cab`. Admins update with `sf plugins update`.

## Open Questions

- Licence of the public repo. Recommendation: Apache-2.0.
