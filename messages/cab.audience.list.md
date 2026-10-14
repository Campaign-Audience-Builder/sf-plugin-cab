# summary

List the Campaign Audience Builder audiences in an org.

# description

Shows each audience with its name, API name, folder path, type, and last modified date. Audiences that cannot be exported are marked with the reason. Use this command before an export to find API names and folders, or to compare two orgs.

# examples

- List all audiences in the org with the alias "uat":

  <%= config.bin %> <%= command.id %> --target-org uat

- List the audiences in the folder "Marketing/EMEA" and its subfolders:

  <%= config.bin %> <%= command.id %> --target-org uat --folder "Marketing/EMEA"

- Get the list as JSON for a script:

  <%= config.bin %> <%= command.id %> --target-org uat --json

# flags.folder.summary

Show only the audiences in this folder and its subfolders. Use the path that the CAB UI shows, with "/" between folders.

# noAudiences

No audiences found in %s.

# summaryLine

%s audiences in %s. %s cannot be exported.

# reading

Reading the audiences
