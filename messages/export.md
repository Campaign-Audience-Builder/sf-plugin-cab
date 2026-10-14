# reading

Reading the audiences in %s

# building

Exporting %s audiences

# prompt.select

Select the audiences to export from %s:

# prompt.overwrite

The file %s exists. Overwrite it?

# info.added

Added %s audiences that %s uses: %s

# info.skipped

%s audiences cannot be exported:

# info.noApiNameAll

%s audiences have no API name and are not exported. To see them, run: sf cab audience list -o %s

# info.written

Exported %s audiences, %s Filter Library templates, %s outcome definitions, and %s folders to:
  %s

# skip.noApiName

The audience has no API name, so it cannot be matched in another org. Set an API name on the audience, then export again.

# skip.usesNoApiName

Uses %s, which has no API name. Set an API name on %s in %s, then export again.

# skip.usesSkipped

Uses %s, which cannot be exported.

# warn.idLike

%s filter values look like record Ids. Such a value can be wrong in another org. Check these filters after the import:

# warn.idLike.line

  ! %s: %s = %s Id %s

# warn.duplicateKey

Two or more records in the source org have the name "%s". The file keeps each one with a number after the name. The import cannot match them by name.

# error.ambiguous

"%s" matches no API name and the names of more than one audience:
%s

# error.notFound

No audience in %s has the API name or name "%s". Similar names: %s

# error.folderNotFound

No folder in %s has the path "%s". Similar folders: %s

# error.selection.action

Select by API name with --name, or see the names and API names: sf cab audience list -o %s

# error.noSelection

No audiences selected, and the command cannot show the selection list because the terminal is not interactive.

# error.noSelection.actions

- Export all audiences: --all
- Export audiences by API name or name: --name <name> (one flag for each audience)
- Export the audiences in a folder and its subfolders: --folder "<path>"

# error.nothing

No audience can be exported. See the reasons above.

# error.exists

The file %s exists.

# error.exists.action

Give a different file with --output-file, or overwrite the file with --overwrite.
