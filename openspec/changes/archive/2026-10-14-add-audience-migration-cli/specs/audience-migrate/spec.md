## Purpose

Lets an admin copy audiences from a source org to a target org with one command, for the frequent case where both orgs are available at the same time.

## ADDED Requirements

### Requirement: Copy in one command
The `sf cab audience migrate` command SHALL take `--source-org` and `--target-org`. It SHALL accept the same selection flags as `export` and the same import flags as `import`. Its result SHALL be the same as an export from the source followed by an import of that file into the target.

#### Scenario: Go-live copy
- **WHEN** the admin runs `sf cab audience migrate --source-org uat --target-org prod --all`
- **THEN** the command exports all audiences from `uat`, shows the import plan for `prod`, and imports after one confirmation

#### Scenario: Same org twice
- **WHEN** the source org and the target org are the same org
- **THEN** the command stops with "Source and target are the same org" and makes no change

### Requirement: Keep the export file
The migrate command SHALL keep the export file that it creates, and it SHALL show its path. The admin SHALL be able to use this file to repeat the import or to import into a third org.

#### Scenario: Repeat after a failure
- **WHEN** a migrate run ends with failed audiences
- **THEN** the summary shows the command `sf cab audience import -o <target> --file <export file>` to run the import again after a fix
