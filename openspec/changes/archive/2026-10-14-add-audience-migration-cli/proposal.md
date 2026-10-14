## Why

Admins who use Campaign Audience Builder (CAB) cannot move audiences between orgs. Today they rebuild each audience by hand in the target org. This is slow and causes errors. The problem is largest at a go-live, when an admin must move hundreds of audiences from a sandbox to production.

## What Changes

- New public sf CLI plugin `sf-plugin-cab`. Admins install it with `sf plugins install`. It uses their existing sf CLI org aliases, so there is no new login.
- New command `sf cab audience list`: shows the audiences in an org, so the admin can see names, folders, and problems before an export.
- New command `sf cab audience export`: writes the definition of selected audiences to one JSON file. Selection by name, by folder, or `--all`. Without a selection flag, the admin selects audiences in an interactive list.
- New command `sf cab audience import`: writes the audiences from a file into an org. It shows a plan first and asks for one confirmation. Each audience is written in one transaction, so a failure never leaves a half-written audience.
- New command `sf cab audience migrate`: export and import in one step, from a source org to a target org. This is the command for the most frequent case.
- The plugin reads the CAB schema of each org at runtime. Thus it works with every CAB package version, and it needs no change when CAB adds a field.
- Before each import, the plugin writes a backup file of the target audiences that it changes. The admin can import the backup file to undo the change.

## Capabilities

### New Capabilities

- `audience-export`: selection of audiences in a source org and the export file that holds their definitions.
- `audience-import`: the import of an export file into a target org, with matching, replacement of the filter tree, preflight checks, backup, and the result report.
- `audience-migrate`: a direct copy from a source org to a target org in one command.
- `cli-interaction`: behavior that all commands share: org display, prompts and their flag equivalents, non-interactive mode, messages, progress, JSON output, and exit codes.

### Modified Capabilities

None. This is the first change in the repo.

## Impact

- New repo `Campaign-Audience-Builder/sf-plugin-cab` (public). New npm package for the plugin, published with npm provenance. Only Salesforce can sign sf CLI plugins, so admins add the plugin to the sf CLI allowlist to install it with no question.
- No change to the CAB managed package is necessary for version 1. The plugin uses the `UniqueName__c` key on Filter Library templates and outcome definitions when the field exists. A separate CAB change adds this field on the summer26 release.
- The plugin uses the Salesforce REST API (query, describe, Composite Graph). Each imported audience uses one or two API calls in the target org.
