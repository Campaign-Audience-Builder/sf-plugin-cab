# audience-export Specification

## Purpose

Lets an admin select CAB audiences in a source org and write their full definitions to one portable, human-readable file that another org can import.

## Requirements

### Requirement: List audiences in an org
The `sf cab audience list` command SHALL show every audience in the org that the user can read. For each audience, it SHALL show the name, the API name, the folder path, the type (Standard, Combination, or Waterfall), and the last modified date. It SHALL mark each audience that cannot be exported, with the reason.

#### Scenario: List all audiences
- **WHEN** the admin runs `sf cab audience list -o uat`
- **THEN** the command shows one row for each audience, sorted by folder path and then by name

#### Scenario: Audience without an API name
- **WHEN** an audience in the org has no value in its API name field
- **THEN** the row for that audience shows "No API name: cannot be matched in another org"

#### Scenario: Filter the list by folder
- **WHEN** the admin runs `sf cab audience list -o uat --folder "Marketing/EMEA"`
- **THEN** the command shows only the audiences in that folder and in its subfolders

### Requirement: Select audiences for export
The `sf cab audience export` command SHALL accept these selections: `--all`, one or more `--name` values, and one or more `--folder` values. `--name` and `--folder` SHALL be combinable. `--all` SHALL NOT be combinable with `--name` or `--folder`. A `--name` value SHALL match the API name first. If no API name matches, it SHALL match the audience name.

#### Scenario: Export all audiences
- **WHEN** the admin runs `sf cab audience export -o uat --all`
- **THEN** the export file contains every exportable audience in the org

#### Scenario: Name matches more than one audience
- **WHEN** a `--name` value matches no API name and matches the names of two audiences
- **THEN** the command stops before it writes a file, and it lists the two audiences with their API names, so the admin can select by API name

#### Scenario: Name matches no audience
- **WHEN** a `--name` value matches no audience
- **THEN** the command stops before it writes a file, and it shows the three most similar audience names

#### Scenario: Interactive selection
- **WHEN** the admin gives no selection flag and the terminal is interactive
- **THEN** the command shows a searchable list of audiences, grouped by folder, in which the admin selects one or more audiences or complete folders

#### Scenario: No selection in a non-interactive run
- **WHEN** the admin gives no selection flag and the terminal is not interactive
- **THEN** the command stops with a message that names the `--all`, `--name`, and `--folder` flags

### Requirement: Include sequence components automatically
When the selection contains a Combination or Waterfall audience, the export SHALL also include every audience that the sequence uses, at all levels of nesting. The command SHALL tell the admin which audiences it added and why.

#### Scenario: Selected sequence uses unselected audiences
- **WHEN** the admin exports only the sequence "Q4 Waterfall", which uses the audiences "Leads DE" and "Leads AT"
- **THEN** the export file contains all three audiences, and the output shows "Added 2 audiences that Q4 Waterfall uses: Leads DE, Leads AT"

### Requirement: Include used templates and outcome definitions
The export SHALL include each Filter Library template and each outcome definition that an exported audience uses, with its complete filter tree. Each one SHALL be stored once in the file, also when several audiences use it. The file SHALL identify each one by its `UniqueName__c`. If the source org has no `UniqueName__c` field on that object, the file SHALL identify it by its name.

#### Scenario: Two audiences use one template
- **WHEN** the audiences "Leads DE" and "Leads AT" both use the template "Active Customers"
- **THEN** the file contains the template "Active Customers" one time, and both audiences refer to it by its key

### Requirement: Skip audiences that cannot be exported
The export SHALL skip each audience that has no API name. It SHALL list each skipped audience with the reason. If a skipped audience is a component of a selected sequence, the export SHALL also skip the sequence and give that reason.

#### Scenario: Component without an API name
- **WHEN** the sequence "Q4 Waterfall" uses an audience that has no API name
- **THEN** the export skips both audiences, and the output tells the admin to set an API name on the component in the source org

### Requirement: Export file content
The export file SHALL contain, for each audience, the definition records: the audience, its version, its sequence components, and its complete filter tree with data inclusions and sort configurations. It SHALL NOT contain run results, run history, schedules, scheduled actions, or campaign members. The file SHALL refer to other records by stable keys (API name, folder path, `UniqueName__c`), never by record Id. The file SHALL contain a header with the format version, the plugin version, the source org name and Id, the CAB package version, and the export time.

#### Scenario: File refers to a folder
- **WHEN** an exported audience is in the folder "Marketing" > "EMEA"
- **THEN** the file stores the folder as the path "Marketing/EMEA" and the folder unique names, not as a record Id

#### Scenario: File is stable for version control
- **WHEN** the admin exports the same unchanged audiences two times
- **THEN** the two files are identical except for the export time in the header

### Requirement: Fields read from the org schema
The export SHALL include every field of an exported object that the schema of the source org shows as a definition field. It SHALL exclude formula fields, roll-up fields, system fields, and fields that describe run state. A new CAB field SHALL be exported without a change to the plugin.

#### Scenario: CAB adds a new text field
- **WHEN** a new CAB version adds a text field to the filter object, and the source org has that version
- **THEN** the export file contains the new field with no plugin update

### Requirement: Objects missing in the source org
The export SHALL skip each object of the audience definition that does not exist in the source org, with no error. An example is an object that only a newer CAB version has.

#### Scenario: Older CAB version in the source org
- **WHEN** the source org has a CAB version without Filter Library template references
- **THEN** the export completes, and the file contains no template references

### Requirement: Output file location
The export SHALL write to the path in `--output-file`. Without this flag, it SHALL write to `cab-audiences-<org alias>-<YYYYMMDD-HHmm>.json` in the current directory. It SHALL NOT overwrite an existing file unless the admin confirms or gives `--overwrite`.

#### Scenario: Default file name
- **WHEN** the admin runs `sf cab audience export -o uat --all` at 14:05 on 2026-10-14
- **THEN** the command writes `cab-audiences-uat-20261014-1405.json` and shows its full path

### Requirement: Org-specific values in filters
The export SHALL find filter values that look like Salesforce record Ids. It SHALL list each one with the audience name and the filter field, because such a value can be wrong in another org.

#### Scenario: Filter on an owner Id
- **WHEN** an audience has the filter "OwnerId = 0055g00000ABCDE"
- **THEN** the export output shows a warning that names the audience and the field `OwnerId`, and the export continues
