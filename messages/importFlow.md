# planning

Checking the audiences against %s

# dryRun

Dry run: nothing was changed, and no backup file was written.

# question.header

%s %s do not exist in %s:

# question.folders

Create these folders? Without them, %s audiences are imported without a folder.

# question.templates

Create these templates? Without them, %s audiences are imported without the template link.

# question.outcomes

Create these outcome definitions? Without them, %s audiences are blocked.

# afterAnswers

With your answers: %s create, %s update, %s unchanged, %s blocked.

# error.needFlag

%s %s are missing. Add %s create, skip, or fail.

# error.failAnswer

%s %s do not exist in %s, and %s is "fail". Nothing was changed.

# error.needYes

The import would change %s audiences in %s, but the terminal is not interactive, so the command cannot ask for confirmation. Nothing was changed.

# error.needYes.action

Check the plan above, then run the command again with --yes.

# confirm

Import %s audiences into %s as %s?

# declined

Nothing was changed in %s.

# nothing

Nothing to import: all audiences in the file are unchanged in %s.

# nothingBlocked

Nothing to import into %s: all audiences are unchanged or blocked. Fix the problems above, then run the import again.

# backupLine

Backup of the %s updated audiences: %s

# importing

Importing

# stopping

Stopping after the current audience. Press Ctrl+C again to stop now.

# summary.counts

Done: %s created, %s updated, %s unchanged, %s skipped, %s failed.

# summary.notProcessed

%s audiences were not processed.

# summary.libraryCreated

Created %s %s. %s

# summary.libraryFailed

Could not create %s %s: %s

# summary.problems

Not imported:

# summary.restoreCreated

The import that made this backup also created %s audiences. A restore does not remove them:

# summary.report

Report: %s

# summary.backup

Backup: %s
To undo the updates, run: sf cab audience import -o %s --file %s

# summary.continue

The import stopped. To continue, run the same command again: %s

# summary.rerun

After a fix, run the import again: %s

# dryRun.flag

The import asks what to do with them. In a pipeline, give the answer with %s create, skip, or fail.

# question.defaults.header

%s of the templates to create are default templates in the source org. Campaign Audience Builder applies a default template to every new audience in %s:

# question.defaults

Keep them as default templates? Then they apply to all new audiences in %s, not only to the imported audiences. If you answer "no", the import creates them as normal templates.

# error.needDefaultsFlag

%s of the templates to create are default templates, which apply to every new audience in the org. Add --template-defaults keep or clear.
