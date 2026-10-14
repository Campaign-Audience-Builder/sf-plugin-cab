/**
 * The export file format (D7). Field names have no namespace prefix. The file never holds a record Id:
 * records inside one tree refer to each other by `ref`, and records outside the tree by a stable key.
 */
export const FORMAT_MAJOR = 1;
export const FORMAT = `cab-audiences/${FORMAT_MAJOR}`;

export type FieldValues = Record<string, unknown>;

export type FileRecord = {
  fields: FieldValues;
  /** Reference fields that pointed to records outside the definition. The import warns about each one (D6). */
  clearedLinks?: string[];
};

export type FileFilter = FileRecord & { ref: string };

export type FileSort = FileRecord & { filterObject: string | null };

export type FileDataInclusion = FileRecord & {
  ref: string;
  parent: string | null;
  aggregateFilter: string | null;
  sorts: FileSort[];
};

export type FileTemplateReference = FileRecord & { template: string };

export type FileNode = FileRecord & {
  ref: string;
  parent: string | null;
  aggregateChainStart: string | null;
  /** Key of the outcome definition that this node filters on. */
  outcome: string | null;
  filters: FileFilter[];
  dataInclusions: FileDataInclusion[];
  templateReferences: FileTemplateReference[];
};

export type FileComponent = FileRecord & { audience: string };

export type FileAudience = FileRecord & {
  apiName: string;
  /** Folder path, for example "Marketing/EMEA". */
  folder: string | null;
  version: FileRecord;
  components: FileComponent[];
  tree: FileNode[];
};

export type FileFolder = { uniqueName: string; label: string; parent: string | null; path: string };

export type FileTemplate = { key: string; name: string; tree: FileNode[] };

/**
 * An outcome definition: its configuration only. The file holds the definition fields, the snapshot of
 * its latest version, and its condition tree. It never holds cohorts, holdouts, assignments, or measurements.
 */
export type FileOutcome = FileRecord & { key: string; name: string; tree: FileNode[]; version: FileRecord | null };

export type ExportFile = {
  format: string;
  exportedAt: string;
  plugin: string;
  source: { org: string; orgId: string; isSandbox: boolean; cabVersion: string | null };
  folders: FileFolder[];
  templates: FileTemplate[];
  outcomeDefinitions: FileOutcome[];
  audiences: FileAudience[];
  /** Set in a backup file: the org of the import, and the audiences that the import created. A restore does not remove them. */
  backup?: { of: string; createdAudiences: string[] };
};
