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

export type FileOutcome = FileRecord & { key: string; name: string; tree: FileNode[] };

export type ExportFile = {
  format: string;
  exportedAt: string;
  plugin: string;
  source: { org: string; orgId: string; isSandbox: boolean; cabVersion: string | null };
  folders: FileFolder[];
  templates: FileTemplate[];
  outcomeDefinitions: FileOutcome[];
  audiences: FileAudience[];
};
