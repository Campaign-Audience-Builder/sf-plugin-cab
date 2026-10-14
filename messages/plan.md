# block.object

Object %s does not exist in %s. Deploy it first, then run the import again.

# block.field

Field %s does not exist in %s. Deploy it first, then run the import again.

# block.class

Custom filter class %s does not exist in %s. Deploy it first, then run the import again.

# block.running

A run is in progress. Run the import again when the run is complete.

# block.componentMissing

Uses %s, which is in neither the file nor %s.

# block.componentBlocked

Uses %s, which is blocked.

# block.outcome

Uses outcome definition %s, which does not exist in %s.

# warn.objectMissing

%s %s not imported: %s has an older CAB version.

# warn.fieldMissing

Field %s does not exist in %s. Its values are not imported.

# warn.fieldReadOnly

You cannot edit field %s in %s. Its values are not imported.

# warn.notLinked

Not linked to Filter Library template %s.

# warn.liveLinkNotCreated

Not linked to Filter Library template %s (%s). The import cannot create this link in %s, and the template conditions are not part of the audience. Thus the audience can select other records. Link the template again in %s after the import.

# warn.clearedLink

Link %s is cleared, because it points to a record outside the audience definition.

# warn.noFolder

Imported without a folder, because the folder %s does not exist.

# warn.removedComponents

%s removed components.

# warn.large

Large: not atomic. The audience needs %s record operations, more than one transaction allows. The import writes it in several steps. If a step fails, restore the audience from the backup file.

# warn.templateDiffers

Template %s differs in %s and was not changed. %s other audiences in %s use it.

# warn.outcomeDiffers

Outcome definition %s differs in %s and was not changed. %s other audiences in %s use it.

# warn.ambiguousTemplate

Template %s cannot be matched: %s has %s templates with this name. Give the templates different names or a unique name.

# warn.ambiguousOutcome

Outcome definition %s cannot be matched: %s has %s outcome definitions with this name. Give them different names or a unique name.

# cannot.templatePermission

You cannot create Filter Library templates in %s. Assign the permission set "FilterLibraryManagement" first.

# cannot.templateAggregate

The template has aggregate filters. Campaign Audience Builder lets only its own UI create such templates.

# cannot.outcomeObject

%s has a CAB version without outcome definitions.

# cannot.outcomePermission

You cannot create outcome definitions in %s. Assign the permission set "OutcomeManagement" first.

# cannot.outcomeNoVersion

The file has no version of the outcome definition. Export the audiences again with this plugin version.

# cannot.outcomeIds

The outcome definition refers to records of the source org. Create it in the target org first, then run the import again.
