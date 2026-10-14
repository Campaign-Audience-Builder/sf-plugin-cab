## 1. Scaffold

- [x] 1.1 Generate the plugin with `sf dev generate plugin` (TypeScript, oclif, `@salesforce/sf-plugins-core`) and set the npm package name
- [x] 1.2 Add the `cab audience` topic with empty `list`, `export`, `import`, and `migrate` commands, their flags, and `--help` examples
- [x] 1.3 Set up lint, unit tests (mocha + `@salesforce/core` test context), and a GitHub Actions workflow for lint and tests
- [x] 1.4 Write the README: install, first migration in three commands, go-live example, CI example, restore from a backup

## 2. Org and schema layer

- [ ] 2.1 Detect the CAB namespace (`lb__` or none) and the CAB package version of an org; fail with the "not installed" message if CAB is missing
- [ ] 2.2 Read the org name, the user, and the sandbox flag for the org line on the plan screen
- [ ] 2.3 Describe the candidate objects, skip missing objects, and build the list of writable fields from the field rules and the deny-list (D5)
- [ ] 2.4 Check create, edit, and delete access on the definition objects for the running user
- [ ] 2.5 Add a unit test that fails when a CAB object with a lookup into the definition is not on the candidate list

## 3. Export

- [ ] 3.1 Query audiences, folders, versions, components, and filter trees in bulk (no query per audience)
- [ ] 3.2 Resolve the selection: `--all`, `--name` (API name, then name, with ambiguity and "did you mean" messages), `--folder` with subfolders
- [ ] 3.3 Add the sequence closure with nesting, cycle detection, and the "added because" message
- [ ] 3.4 Skip audiences without an API name, and the sequences that use them, with reasons
- [ ] 3.5 Collect the templates and outcome definitions that the selected audiences use, with their filter trees, one time each
- [ ] 3.6 Convert records to the file form: no Ids, local `ref` values for self-lookups, keys for folders, templates, and outcome definitions, no namespace prefix (D7)
- [ ] 3.7 Flag Id-like filter values with the key prefixes from describe-global (D11)
- [ ] 3.8 Write the file with sorted keys, the default file name, and overwrite protection
- [ ] 3.9 Implement `list` with the folder filter and the "cannot be exported" markers
- [ ] 3.10 Implement the interactive selection list, grouped by folder and searchable (D4)

## 4. Import planning

- [ ] 4.1 Read and validate the file and its format version
- [ ] 4.2 Match audiences by API name (case-insensitive), and find target-only audiences
- [ ] 4.3 Normalize and hash both sides, and mark unchanged audiences (D9)
- [ ] 4.4 Resolve references with the rules in D6: folders, components, templates, outcome definitions, and cleared links with warnings
- [ ] 4.5 Check each audience: objects and fields in the target (Tooling API `FieldDefinition`), custom filter classes, outcome definitions, runs in progress
- [ ] 4.6 Order audiences by sequence dependencies, and propagate "blocked" to dependent sequences
- [ ] 4.7 Count graph nodes for each audience, and mark audiences above 500 nodes as "large: not atomic"
- [ ] 4.8 Match templates and outcome definitions by `UniqueName__c`, then by unique name; find missing and differing records (D12)
- [ ] 4.9 Spike: create an outcome definition with its template tree through REST in a summer26 scratch org, run a tally, and record if it works; if not, remove `create` from `--missing-outcomes`
- [ ] 4.10 Render the plan screen (D3) with numbers first, sections of at most 10 lines, and `--verbose` for all lines

## 5. Import execution

- [ ] 5.1 Ask the folder, template, and outcome questions and the final confirmation, with flag equivalents, safe defaults, and the non-interactive stop
- [ ] 5.2 Write the backup file before the first write
- [ ] 5.3 Create missing folders in parent-first order
- [ ] 5.4 Create missing templates and outcome definitions (one graph each) before the audiences that use them; on failure, clear the links or block the audiences as the spec says
- [ ] 5.5 Build one Composite Graph per audience (D8): audience, version, components, old tree deletes, new tree inserts, and `LastConfigurationChange__c` set to now
- [ ] 5.6 Implement the non-atomic path for large audiences (insert new records, then delete old records)
- [ ] 5.7 Run the graphs one at a time, with one retry on `UNABLE_TO_LOCK_ROW`, `--fail-fast`, and dependent skips after a failure
- [ ] 5.8 Translate Salesforce errors into messages with the audience, the field, and the Salesforce text
- [ ] 5.9 Show progress, handle Ctrl+C after the current audience, and write the report file
- [ ] 5.10 Show the summary with the counts, the failures, the report and backup paths, and the command to run again

## 6. Migrate and shared behavior

- [ ] 6.1 Implement `migrate` as export to a kept file, then import, with the same-org check
- [ ] 6.2 Implement `--json` output for all commands, and the exit codes 0, 1, and 68
- [ ] 6.3 Hide record Ids and stack traces unless `--verbose` is given

## 7. Verification

- [ ] 7.1 Unit tests for selection, closure, file conversion, hashing, reference rules, ordering, and node counts
- [ ] 7.2 End-to-end test on two scratch orgs with the master CAB schema: export all, import, import again (all unchanged), restore from the backup
- [ ] 7.3 End-to-end test from a summer26 org into a master org and back, to confirm that missing objects and fields give warnings and no failure
- [ ] 7.4 Test that an import into a target audience with a schedule keeps the schedule linked to the same version
- [ ] 7.5 Test a forced failure in the last graph node and confirm that the target audience did not change
- [ ] 7.6 Test non-interactive runs: no selection, missing folders and templates without flags (one message names both), and `--yes` with all flags
- [ ] 7.7 Test that an import never changes a template that exists in the target, also when it differs from the file

## 8. Release

- [x] 8.1 Add the licence file (Apache-2.0 unless decided otherwise) and the licence field in package.json
- [ ] 8.2 Sign the npm package, publish version 1.0.0, and confirm `sf plugins install` with no unsigned-plugin prompt
