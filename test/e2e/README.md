# End-to-end tests

These tests run the plugin against real scratch orgs. They are manual, because each scratch org needs a
full deploy of the CAB source, which takes 15 to 30 minutes.

## Orgs

Create the scratch orgs from the cab repo (`Campaign-Audience-Builder/cab`). Extract the source with
`git archive`, so the cab checkout does not change:

```sh
git -C <cab repo> archive master | tar -x -C /tmp/cab-master
git -C <cab repo> archive release/summer26 | tar -x -C /tmp/cab-s26
(cd /tmp/cab-master && sf org create scratch -v <dev hub> -f config/project-scratch-def.json -a cabplugin-master -y 7 -w 60)
(cd /tmp/cab-master && sf project deploy start -o cabplugin-master -w 90)
sf org assign permset -o cabplugin-master -n CampaignAudienceBuilderUser -n CampaignAudienceBuilderAdmin
sf apex run -o cabplugin-master -f test/e2e/seed-audiences.apex
```

Do the same for `cabplugin-s26` with the summer26 source, and also assign `FilterLibraryManagement` and
`OutcomeManagement`.

## Checks and results of 2026-10-14

| Task | Command | Result |
| --- | --- | --- |
| 7.2 | Note: 7.2 used one master org as source and target. A second master org was not created. | |
| 7.2 | `export -o cabplugin-master --all` two times | The files differ only in `exportedAt`. |
| 7.2 | `import -o cabplugin-master --file <export>` | 5 unchanged. |
| 7.2 | Change one filter value, `import --yes` | 1 updated. Same version Id, old filter objects deleted, `LastConfigurationChange__c` set. |
| 7.2 | `import` of the backup file | 1 updated. The next import of the original file shows 5 unchanged. |
| 7.3 | `migrate --source-org cabplugin-master --target-org cabplugin-s26 --all --missing-folders create --yes` | 6 created, 3 folders created. The next run shows 6 unchanged. |
| 7.3 | `migrate --source-org cabplugin-s26 --target-org cabplugin-master --all` | One warning for each summer26 field. 1 created, 6 unchanged, no failure. |
| 7.4 | Update of `B6_Outcome_Filter_Seed`, which has a schedule and a scheduled action | The schedule points to the same version after the import. |
| 7.5 | A filter value of 300 characters in the last filter object of `Leads DE` | Failed with STRING_TOO_LONG. The filter object Ids and the values of the audience did not change. Exit code 1. |
| 7.5 | A new audience whose last graph node (the last filter) has a value of 300 characters | Failed. No audience, version, or filter object of it stays in the org. |
| 7.6 | `export` with no selection flag | Stops and names `--all`, `--name`, and `--folder`. |
| 7.6 | `import` with a missing folder and a missing template, no flags | One message names `--missing-folders` and `--missing-templates`. |
| 7.6 | `import` with all flags and `--yes --json` | Folder and template created, 1 updated, no question. |
| 7.7 | Template "Active Customers" with other filters in the file than in the target | The plan warns. The target template keeps its filter. The audience links to it. |
| 5.6 | An audience with 600 filters | "Large: not atomic". Written in 2 graphs. The next run shows it unchanged. |
| 5.4 | Outcome definition missing in the target, `--missing-outcomes create` | Definition, version 1, and condition tree created. No assignment and no measurement. The audience node links to it. |

Not tested against an org: Ctrl+C during an import, `--fail-fast` with several failures, and an import
into a packaged (`lb__`) subscriber org.
