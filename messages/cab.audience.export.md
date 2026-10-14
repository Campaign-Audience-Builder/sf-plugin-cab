# summary

Export Campaign Audience Builder audiences to a file.

# description

Writes the complete definition of the selected audiences to one JSON file: the audience, its version, its sequence components, and its filter tree. The file also contains the folders, the Filter Library templates, and the outcome definitions that the audiences use. It does not contain run results, schedules, or campaign members.

Select audiences with --all, --name, or --folder. Without a selection flag, the command shows a list in which you select audiences. When you select a Combination or Waterfall audience, the command also exports the audiences that it uses.

Import the file into another org with "sf cab audience import".

# examples

- Export all audiences from the org with the alias "uat":

  <%= config.bin %> <%= command.id %> --target-org uat --all

- Export two audiences by API name or name:

  <%= config.bin %> <%= command.id %> --target-org uat --name Leads_DE --name "Spring Promo"

- Export all audiences in a folder and its subfolders to a given file:

  <%= config.bin %> <%= command.id %> --target-org uat --folder "Marketing/EMEA" --output-file emea.json

- Select the audiences in a list:

  <%= config.bin %> <%= command.id %> --target-org uat

# flags.all.summary

Export all audiences that can be exported.

# flags.name.summary

API name or name of an audience to export. Give the flag one time for each audience.

# flags.name.description

The command first looks for an audience with this API name. If there is none, it looks for an audience with this name.

# flags.folder.summary

Export all audiences in this folder and its subfolders. Use the path that the CAB UI shows, with "/" between folders.

# flags.output-file.summary

Path of the export file. Default: cab-audiences-<org alias>-<YYYYMMDD-HHmm>.json in the current directory.

# flags.overwrite.summary

Overwrite the export file if it exists.
