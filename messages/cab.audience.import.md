# summary

Import Campaign Audience Builder audiences from a file into an org.

# description

Reads an export file and writes its audiences into the target org. The command first shows a plan: which audiences it creates, updates, and skips, and what is wrong. It changes nothing until you confirm.

An audience is matched to a target audience by its API name. Each audience is written in one transaction, so a failure never leaves a half-written audience. The schedules, runs, and campaign members of an updated audience stay linked.

Before the first change, the command writes a backup file of the target audiences that it updates. To undo the import, import the backup file. To continue a stopped import, run the same command again.

# examples

- Show the plan for an import into the org with the alias "prod", with no change:

  <%= config.bin %> <%= command.id %> --target-org prod --file golive.json --dry-run

- Import a file. The command shows the plan and asks for confirmation:

  <%= config.bin %> <%= command.id %> --target-org prod --file golive.json

- Import in a CI pipeline, with no questions:

  <%= config.bin %> <%= command.id %> --target-org prod --file golive.json --missing-folders create --missing-templates create --missing-outcomes fail --yes

- Restore the audiences from a backup file:

  <%= config.bin %> <%= command.id %> --target-org prod --file cab-backup-prod-20261014-1412.json

# flags.file.summary

Path of the export file to import.

# flags.dry-run.summary

Show the plan and stop. The command changes nothing and writes no backup file.

# flags.yes.summary

Import with no confirmation.

# flags.fail-fast.summary

Stop after the first audience that fails.

# flags.missing-folders.summary

What to do with folders that do not exist in the target org: create them, skip them (the audiences get no folder), or fail before any change.

# flags.missing-templates.summary

What to do with Filter Library templates that do not exist in the target org: create them, skip them (the audiences are imported without the template link), or fail before any change.

# flags.missing-outcomes.summary

What to do with outcome definitions that do not exist in the target org: create them, skip them (the audiences that use them are blocked), or fail before any change.
