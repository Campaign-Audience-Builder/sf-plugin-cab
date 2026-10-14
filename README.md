# sf-plugin-cab

An sf CLI plugin that moves [Campaign Audience Builder](https://github.com/Campaign-Audience-Builder) (CAB) audiences between Salesforce orgs.

Use it to copy audiences from a sandbox to production at a go-live, to keep a UAT org in step with production, or to keep audience definitions in version control. The plugin uses the orgs that your sf CLI already knows. There is no separate login.

## Install

```sh
sf plugins install @campaign-audience-builder/sf-plugin-cab
```

The package is signed. The sf CLI verifies the signature and does not ask you to trust an unsigned plugin. To update the plugin, run `sf plugins update`.

You need:

- The sf CLI, with an alias for each org (`sf org login web --alias uat`).
- Campaign Audience Builder in each org.
- In the target org, create, edit, and delete access to the CAB objects. The permission set `CampaignAudienceBuilderUser` gives this access.

## Your first migration in three commands

```sh
# 1. See which audiences the source org has.
sf cab audience list -o uat

# 2. See what an import into the target org would change. This changes nothing.
sf cab audience migrate --source-org uat --target-org prod --all --dry-run

# 3. Copy the audiences. The command shows the plan and asks one time before it changes the org.
sf cab audience migrate --source-org uat --target-org prod --all
```

Instead of `--all`, you can select audiences with `--name` (API name or name) and `--folder` (folder path, for example `"Marketing/EMEA"`). Without a selection flag, the command shows a list in which you select audiences.

When you select a Combination or Waterfall audience, the plugin also copies the audiences that it uses.

## Commands

| Command | What it does |
| --- | --- |
| `sf cab audience list` | Shows the audiences in an org, with API names, folders, and audiences that cannot be exported. |
| `sf cab audience export` | Writes the selected audiences to a JSON file. |
| `sf cab audience import` | Writes the audiences from a file into an org. Shows a plan first. |
| `sf cab audience migrate` | Export and import in one step. Keeps the export file. |

Run any command with `--help` for all flags and examples.

## How the import works

- An audience in the file is matched to a target audience by its **API name**, with no regard to letter case. A match is updated. An audience with no match is created.
- An audience without an API name cannot be matched, so the export skips it. Set an API name in the source org first.
- Each audience is written in **one transaction**. If a part fails, the target audience does not change.
- An update keeps the target audience version and sequence components. Schedules, run history, and campaign members stay linked.
- Audiences that did not change are not written. Thus a second run of the same import is fast and changes nothing.
- Folders, Filter Library templates, and outcome definitions are matched by their unique name. The import can create missing ones. It never changes ones that exist in the target.
- Target audiences that are not in the file stay unchanged.
- Filter values that look like record Ids give a warning, because an Id from one org can be wrong in another org.

## Go-live: copy hundreds of audiences to production

Export from the sandbox one time, check the file, and import it:

```sh
sf cab audience export -o uat --all --output-file golive.json
sf cab audience import -o prod --file golive.json --dry-run
sf cab audience import -o prod --file golive.json
```

The plan screen shows the target org, the numbers of audiences to create, update, and skip, and each problem. If the connection fails during the import, run the same command again. The second run skips the audiences that are already imported.

## CI: import with no questions

In a pipeline, the command never asks. Give each answer with a flag. If an answer is necessary and no flag gives it, the command stops before any change and names the flag.

```sh
sf cab audience import -o prod --file audiences/golive.json \
  --missing-folders create \
  --missing-templates create \
  --missing-outcomes fail \
  --yes --json
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | All audiences were imported or are unchanged. |
| 1 | Nothing was changed, because of an error or a "no" answer. |
| 68 | Some audiences were imported, and some failed or were skipped. |

## Restore from a backup

Before the first change, the import writes a backup file of the target audiences that it updates, for example `cab-backup-prod-20261014-1412.json`. The backup file has the export format. To undo the import, import the backup file:

```sh
sf cab audience import -o prod --file cab-backup-prod-20261014-1412.json
```

The restore gives the updated audiences their previous definitions. It does not delete the audiences that the import created. The restore output lists them.

## What the plugin does not copy

Schedules, scheduled actions, final actions, run results, and campaign members stay in each org. The import does not delete target audiences, and it does not change Filter Library templates or outcome definitions that exist in the target.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
