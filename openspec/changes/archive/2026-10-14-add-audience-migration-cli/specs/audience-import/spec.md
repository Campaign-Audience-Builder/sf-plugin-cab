## Purpose

Lets an admin write the audiences from an export file into a target org safely: with a plan before any change, one transaction per audience, a backup, and a clear result report.

## ADDED Requirements

### Requirement: Match audiences by API name
The `sf cab audience import` command SHALL match each audience in the file to a target audience with the same API name. The match SHALL ignore letter case. An audience with no match SHALL be created. An audience with a match SHALL be updated.

#### Scenario: Audience exists in the target
- **WHEN** the file contains the audience `Spring_Promo` and the target has an audience with the API name `spring_promo`
- **THEN** the import updates the target audience and does not create a second one

### Requirement: Keep the identity of version and sequence components
When the import updates an audience, it SHALL keep the record of the audience version and the records of the sequence components. It SHALL update their fields. Thus target schedules, run history, scheduled actions, and campaign member links that point to these records SHALL stay valid.

#### Scenario: Target audience has a schedule
- **WHEN** the import updates an audience that has an active schedule in the target
- **THEN** the schedule still points to the same audience version after the import, and it runs the new definition at its next run

#### Scenario: Sequence component order changes
- **WHEN** the file gives a sequence three components and the target sequence has two
- **THEN** the import updates the two target components by their order and creates the third

#### Scenario: Sequence has fewer components in the file
- **WHEN** the file gives a sequence two components and the target sequence has three
- **THEN** the import deletes the third target component and lists it in the plan as "removed component"

### Requirement: Replace the filter tree
When the import updates an audience, it SHALL delete all filter objects of the target version, with their filters, data inclusions, sort configurations, and template references. It SHALL then create the filter tree from the file. No record of the old tree SHALL stay in the org.

#### Scenario: Old tree has nested filter objects
- **WHEN** the target audience has a root filter object with two levels of child filter objects
- **THEN** after the import, none of the old filter objects exist in the org

### Requirement: One transaction per audience
The import SHALL write each audience in one all-or-nothing transaction: the audience, the version, the sequence components, the deletion of the old tree, and the creation of the new tree. If any part fails, no part of that audience SHALL change.

#### Scenario: Invalid value in one filter
- **WHEN** the target org rejects one filter of an audience
- **THEN** the target audience keeps its previous definition, and the report shows the audience as failed, with the Salesforce error message and the filter field

#### Scenario: Audience is too large for one transaction
- **WHEN** an audience needs more record operations than one transaction allows
- **THEN** the plan marks the audience as "large: not atomic", and the import writes it in several steps with the backup as the recovery path

### Requirement: Import order and dependent failures
The import SHALL write each sequence component before the sequence that uses it. If an audience fails or is skipped, the import SHALL skip every sequence that uses it, and it SHALL name the cause.

#### Scenario: Component fails
- **WHEN** the audience "Leads DE" fails and the sequence "Q4 Waterfall" uses it
- **THEN** the import skips "Q4 Waterfall" with the reason "uses Leads DE, which failed"

#### Scenario: Component is in the target but not in the file
- **WHEN** a sequence in the file uses the API name `Leads_AT`, the file does not contain it, and the target has it
- **THEN** the import links the sequence to the target audience `Leads_AT`

#### Scenario: Component is in neither the file nor the target
- **WHEN** a sequence uses an API name that is in neither the file nor the target
- **THEN** the plan marks the sequence as blocked with the missing API name

### Requirement: Continue after a failure by default
After an audience fails, the import SHALL continue with the next audience. With `--fail-fast`, the import SHALL stop after the first failed audience and SHALL list the audiences that it did not process.

#### Scenario: Fail fast
- **WHEN** the admin uses `--fail-fast` and the third of ten audiences fails
- **THEN** the import stops, and the report shows two imported, one failed, and seven not processed

### Requirement: Plan before any change
Before it writes, the import SHALL show a plan: the target org, the number of audiences to create, update, leave unchanged, and skip, and every warning and blocker. It SHALL write nothing until the admin confirms. With `--dry-run`, it SHALL show the plan and stop with no change to the org.

#### Scenario: Dry run
- **WHEN** the admin runs `sf cab audience import -o prod --file golive.json --dry-run`
- **THEN** the command shows the full plan, makes no change in the org, and does not write a backup file

#### Scenario: Admin declines
- **WHEN** the admin answers "no" at the confirmation
- **THEN** the command stops, and the org has no change

### Requirement: Unchanged audiences are not written
The import SHALL compare each matched audience with its target definition. If the definitions are the same, the plan SHALL show the audience as "unchanged", and the import SHALL NOT write it.

#### Scenario: Import the same file a second time
- **WHEN** the admin imports a file that the target already contains with no change
- **THEN** the plan shows all audiences as "unchanged", and the import writes nothing

### Requirement: Safe to run again
An import that stopped before its end SHALL be repeatable with the same command. The second run SHALL complete the remaining audiences and SHALL NOT create duplicates.

#### Scenario: Connection lost during a go-live
- **WHEN** the connection fails after 340 of 512 audiences, and the admin runs the same command again
- **THEN** the plan shows the 340 audiences as "unchanged", and the import writes the other 172

### Requirement: Checks that block the complete import
Before the plan, the import SHALL check the target org. It SHALL stop with no change if one of these conditions is true:
- CAB is not installed in the target.
- The user cannot create, edit, and delete the CAB definition objects.
- The file has a format version that this plugin version cannot read.

#### Scenario: CAB not installed
- **WHEN** the target org does not have the CAB package
- **THEN** the command stops with "Campaign Audience Builder is not installed in <org>" and makes no change

#### Scenario: Missing permission
- **WHEN** the user has no delete access to the filter object
- **THEN** the command stops, and it names the permission set "CampaignAudienceBuilderUser" that gives the access

### Requirement: Checks that block one audience
Before the plan, the import SHALL check each audience against the target org. An audience SHALL be blocked if one of these conditions is true:
- An object or field that its filters use does not exist in the target.
- A custom filter class that it uses does not exist in the target.
- An outcome definition that it uses is not in the target and the admin does not create it (see "Missing templates and outcome definitions").
- A run of the matched target audience is in progress.

The plan SHALL list each blocked audience with each reason. The import SHALL import the other audiences.

#### Scenario: Custom field missing in the target
- **WHEN** an audience filters on `Contact.Region__c` and the target org has no such field
- **THEN** the plan shows the audience as blocked with "Field Contact.Region__c does not exist in <org>. Deploy it first, then run the import again."

#### Scenario: Run in progress
- **WHEN** the target audience `Spring_Promo` has a run in progress
- **THEN** the plan shows it as blocked with "A run is in progress. Run the import again when the run is complete."

### Requirement: Missing folders
If audiences in the file use folders that do not exist in the target, the import SHALL list these folders by path and ask once if it can create them. If the admin declines, the affected audiences SHALL be imported without a folder. The flag `--missing-folders create|skip|fail` SHALL give the answer without a question. `fail` SHALL stop the import before any change.

#### Scenario: Admin creates the folders
- **WHEN** the folder path "Marketing/EMEA" is missing and the admin answers "yes"
- **THEN** the import creates "Marketing" and "EMEA" with the unique names from the file, and puts the audiences in "EMEA"

#### Scenario: Folder exists with the same unique name
- **WHEN** the target has a folder with the unique name from the file but a different label
- **THEN** the import uses the existing target folder and does not change its label

### Requirement: Match templates and outcome definitions
The import SHALL link each filter node to the target Filter Library template or outcome definition with the same `UniqueName__c`. If the target object has no `UniqueName__c` field, the import SHALL match by name, when exactly one record has that name. Two records with the same name SHALL count as no match, and the plan SHALL name them.

#### Scenario: Template exists in the target
- **WHEN** a node uses the template `Active_Customers` and the target has a template with that key
- **THEN** the node links to the target template

### Requirement: Never change existing templates and outcome definitions
The import SHALL NOT change a Filter Library template or an outcome definition that exists in the target, also when its definition differs from the file. If it differs, the plan SHALL show a warning, because other target audiences use the same record.

#### Scenario: Template differs in the target
- **WHEN** the target template `Active_Customers` has other filters than the file
- **THEN** the import links to the target template without a change to it, and the plan shows "Template Active Customers differs in <org> and was not changed. 4 other audiences in <org> use it."

### Requirement: Missing templates and outcome definitions
If audiences in the file use templates or outcome definitions that are not in the target, the import SHALL list them by name and ask once for each type if it can create them. The flags `--missing-templates create|skip|fail` and `--missing-outcomes create|skip|fail` SHALL give the answers without a question. `fail` SHALL stop the import before any change. Created records SHALL get the `UniqueName__c` from the file, when the target has that field.

#### Scenario: Admin creates a missing template
- **WHEN** the template "Active Customers" is missing and the admin answers "yes"
- **THEN** the import creates the template with its filter tree before the first audience that uses it, and links the audience nodes to it

#### Scenario: Admin skips a missing template
- **WHEN** the template "Active Customers" is missing and the admin answers "no"
- **THEN** the nodes are imported with their own filters but without the template link, and the plan shows "Not linked to Filter Library template Active Customers"

#### Scenario: Admin skips a missing outcome definition
- **WHEN** the outcome definition "Purchase within 30 days" is missing and the admin answers "no"
- **THEN** each audience that uses it is blocked with "Uses outcome definition Purchase within 30 days, which does not exist in <org>"

#### Scenario: Creation of a template fails
- **WHEN** the target rejects a template that the import creates
- **THEN** the import does not create the template, and it imports each audience that uses it without the link, with a warning

### Requirement: Created outcome definitions hold the configuration only
When the import creates an outcome definition, it SHALL create only its configuration: the definition, one version with the snapshot of the latest source version, and its condition tree. It SHALL NOT create cohorts, control groups, assignments to scheduled actions, or measurement data.

#### Scenario: Admin creates a missing outcome definition
- **WHEN** the outcome definition "Purchase within 30 days" is missing and the admin answers "yes"
- **THEN** the import creates the definition, version 1, and the condition tree, and the target has no cohort, assignment, or measurement for it

### Requirement: Created default templates
If a template that the import creates is a default template in the source org, the import SHALL ask if it stays a default template. The question SHALL say that the template then applies to every new audience in the target org. The default answer SHALL be "no". The flag `--template-defaults keep|clear` SHALL give the answer without a question. With "clear", the import SHALL create the template as a normal template.

#### Scenario: Admin keeps the default setting
- **WHEN** the created template "Active Customers" is a default template in the source org and the admin answers "yes"
- **THEN** the import creates it as a default template, and CAB applies it to new audiences in the target org

#### Scenario: CI run without the flag
- **WHEN** a non-interactive import must create a default template and has no `--template-defaults` flag
- **THEN** the command stops before any change and names the flag

### Requirement: Template links that the import cannot create
If the import cannot create a link to a Filter Library template, it SHALL import the audience without the link and show a warning. This applies to Locked links, which CAB creates only through its own UI, and to Synced links when the user cannot create links. The warning SHALL say that the template conditions are not part of the imported audience, so the audience can select other records.

#### Scenario: Audience with a Locked template link
- **WHEN** an audience node has a Locked link to the template "Active Customers"
- **THEN** the import writes the audience without the link, and the plan warns that the template conditions are not part of the audience and that the admin must link the template again

### Requirement: Other links
For each other link to a record outside the audience definition, the import SHALL clear the link and show a warning that names the audience, the object, and the field. The import SHALL never write a record Id from the source org into the target.

#### Scenario: Link to a campaign member field mapping
- **WHEN** a data inclusion links to a campaign member field mapping
- **THEN** the import clears the link and shows a warning for that audience

### Requirement: Schema differences between the orgs
The import SHALL write only the fields that exist in the file and in the target. For each field in the file that the target does not have, the plan SHALL show one warning. For each object in the file that the target does not have, the plan SHALL show one warning with the number of records that the import cannot write.

#### Scenario: Target has an older CAB version
- **WHEN** the file contains template references and the target CAB version has no template reference object
- **THEN** the plan shows "12 template references not imported: <org> has an older CAB version", and the import continues

### Requirement: Rebuild results after an update
For each updated audience, the import SHALL mark the target definition as changed now. Thus CAB SHALL not use cached results of the old definition. The import SHALL NOT copy run state from the source.

#### Scenario: Target had cached results
- **WHEN** the import updates an audience with cached results in the target
- **THEN** the next run of that audience in the target rebuilds its results from the new definition

### Requirement: Ownership and audiences only in the target
The import SHALL make the importing user the owner of each created audience. It SHALL keep the owner of each updated audience. It SHALL NOT delete or change target audiences that are not in the file. The plan SHALL show their number.

#### Scenario: Go-live into an org with extra audiences
- **WHEN** the target has 20 audiences that are not in the file
- **THEN** the import does not change them, and the plan shows "20 audiences in <org> are not in the file and stay unchanged"

### Requirement: Backup before the import
Before the first write, the import SHALL write a backup file with the current target definitions of all audiences that it updates. The backup file SHALL have the export file format. The command SHALL show the path of the backup file and how to restore it.

#### Scenario: Restore an update
- **WHEN** the admin imports the backup file into the same org
- **THEN** the updated audiences have their definitions from before the import again

#### Scenario: Restore does not remove created audiences
- **WHEN** the admin restores a backup after an import that also created audiences
- **THEN** the created audiences stay, and the restore output lists them

### Requirement: Result report
At the end, the import SHALL show a summary with the number of audiences created, updated, unchanged, skipped, and failed. It SHALL list each failed or skipped audience with its reason. It SHALL write a report file with the status of each audience next to the backup file.

#### Scenario: Partial failure
- **WHEN** 500 audiences import and 3 fail
- **THEN** the summary shows the three failed audiences with their reasons, and it shows the path of the report file
