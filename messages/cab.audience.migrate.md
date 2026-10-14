# summary

Copy Campaign Audience Builder audiences from one org to another.

# description

Exports the selected audiences from the source org to a file, and then imports the file into the target org. The result is the same as "sf cab audience export" followed by "sf cab audience import". The command shows the import plan and changes nothing until you confirm.

The command keeps the export file. Use it to repeat the import, or to import the same audiences into a third org.

# examples

- Copy all audiences from the org "uat" to the org "prod":

  <%= config.bin %> <%= command.id %> --source-org uat --target-org prod --all

- Show the plan for a copy of one folder, with no change:

  <%= config.bin %> <%= command.id %> --source-org uat --target-org prod --folder "Marketing/EMEA" --dry-run

- Copy two audiences in a CI pipeline, with no questions:

  <%= config.bin %> <%= command.id %> --source-org uat --target-org prod --name Leads_DE --name Leads_AT --missing-folders create --missing-templates create --missing-outcomes create --template-defaults clear --yes

# flags.source-org.summary

Username or alias of the org to copy the audiences from.

# flags.target-org.summary

Username or alias of the org to copy the audiences to.

# flags.output-file.summary

Path of the export file that the command keeps. Default: cab-audiences-<source alias>-<YYYYMMDD-HHmm>.json in the current directory.

# error.sameOrg

Source and target are the same org.

# error.sameOrg.actions

- Give a different org in --target-org.
