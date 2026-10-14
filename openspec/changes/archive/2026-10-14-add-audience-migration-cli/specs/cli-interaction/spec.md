## Purpose

Defines the behavior that all plugin commands share, so an admin always knows which org a command acts on, what it will do, and what to do after an error.

## ADDED Requirements

### Requirement: Use existing sf CLI orgs
Every command SHALL use the org aliases and usernames that the sf CLI already knows. `-o` and `--target-org` SHALL use the default org of the sf CLI when the admin does not give them. No command SHALL ask for a password or a token.

#### Scenario: Org not authorized
- **WHEN** the admin gives `-o prod` and the sf CLI has no org with that alias
- **THEN** the command stops and shows `sf org login web --alias prod` as the next step

### Requirement: Show the org before a change
Before a command changes an org, it SHALL show the org name, the username, the org type (production or sandbox), and the CAB package version. For a production org, the confirmation SHALL include the word "PRODUCTION".

#### Scenario: Import into production
- **WHEN** the admin imports into a production org
- **THEN** the confirmation reads "Import 512 audiences into Acme Corp (PRODUCTION) as admin@acme.com? (y/N)"

### Requirement: Safe default answers
Each confirmation that leads to a change in an org SHALL have "no" as its default answer.

#### Scenario: Admin presses Enter
- **WHEN** the admin presses Enter at the import confirmation without an answer
- **THEN** the command stops with no change

### Requirement: Every question has a flag
Each question that a command can ask SHALL have a flag that gives the answer. `--yes` SHALL confirm the plan. When the terminal is not interactive or `--json` is given, a command SHALL NOT ask. If an answer is necessary and no flag gives it, the command SHALL stop before any change and name the flag.

#### Scenario: CI run without answers
- **WHEN** an import in a CI pipeline finds missing folders and has no `--missing-folders` flag
- **THEN** the command stops before any change with "3 folders are missing. Add --missing-folders create, skip, or fail."

#### Scenario: Several answers missing
- **WHEN** a non-interactive import finds missing folders and missing templates and has neither flag
- **THEN** the command names both flags in one message, so the admin fixes the command one time

#### Scenario: CI run with answers
- **WHEN** the CI pipeline runs `sf cab audience import -o prod --file golive.json --missing-folders create --yes`
- **THEN** the command imports with no question

### Requirement: Clear messages
Every message SHALL name audiences by their name and API name, and folders by their path. Messages SHALL NOT show record Ids unless the admin gives `--verbose`. Each error message SHALL tell what happened and what the admin can do next. A command SHALL NOT show a stack trace unless the admin gives `--verbose`.

#### Scenario: Salesforce rejects a record
- **WHEN** the target org rejects a filter with a validation error
- **THEN** the message shows the audience, the filter field, and the Salesforce message, and no stack trace

### Requirement: Progress for long operations
During an export or an import of more than one audience, the command SHALL show progress with the count and the current audience name. Ctrl+C SHALL stop the command after the current audience, and the summary SHALL list the audiences that were not processed.

#### Scenario: Admin stops a long import
- **WHEN** the admin presses Ctrl+C during audience 120 of 512
- **THEN** the command completes audience 120, stops, writes the report, and shows how to continue with the same command

### Requirement: JSON output
Every command SHALL support `--json`. With `--json`, the command SHALL write only one JSON document to standard output, with the result of each audience, and SHALL write no other text to standard output.

#### Scenario: Script reads the result
- **WHEN** a script runs the import with `--json --yes`
- **THEN** standard output contains one JSON document with the status and the reason of each audience

### Requirement: Exit codes
A command SHALL exit with code 0 when all selected audiences succeed or are unchanged. It SHALL exit with code 1 when it makes no change because of an error or a "no" answer. It SHALL exit with code 68 when some audiences succeed and some fail or are skipped because of an error.

#### Scenario: Partial success
- **WHEN** an import creates 509 audiences and 3 fail
- **THEN** the command exits with code 68

### Requirement: Help with examples
Every command SHALL show in `--help` a short description and at least two examples. One example SHALL show the most frequent use.

#### Scenario: Admin reads the help
- **WHEN** the admin runs `sf cab audience import --help`
- **THEN** the help shows an example with `--dry-run` and an example for CI with `--yes`
