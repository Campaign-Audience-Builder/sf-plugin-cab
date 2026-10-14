import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { ExportedAudience, runExport } from '../../../cab/exportFlow.js';
import { targetOrgFlag, verboseFlag } from '../../../cab/flags.js';
import { connectCab } from '../../../cab/org.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.export');

export type ExportResult = {
  file: string;
  audiences: ExportedAudience[];
  warnings: string[];
};

export default class AudienceExport extends SfCommand<ExportResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': targetOrgFlag,
    all: Flags.boolean({ summary: messages.getMessage('flags.all.summary'), exclusive: ['name', 'folder'] }),
    name: Flags.string({
      char: 'n',
      summary: messages.getMessage('flags.name.summary'),
      description: messages.getMessage('flags.name.description'),
      multiple: true,
    }),
    folder: Flags.string({ summary: messages.getMessage('flags.folder.summary'), multiple: true }),
    'output-file': Flags.file({ summary: messages.getMessage('flags.output-file.summary') }),
    overwrite: Flags.boolean({ summary: messages.getMessage('flags.overwrite.summary') }),
    verbose: verboseFlag,
  };

  public async run(): Promise<ExportResult> {
    const { flags } = await this.parse(AudienceExport);
    const cab = await connectCab(flags['target-org']);
    const outcome = await runExport(this, cab, {
      all: flags.all,
      names: flags.name,
      folders: flags.folder,
      outputFile: flags['output-file'],
      overwrite: flags.overwrite,
      verbose: flags.verbose,
      json: this.jsonEnabled(),
      pluginVersion: this.config.pjson.version,
    });
    // Exit code 68: some audiences that the admin selected were skipped.
    if (outcome.partial) process.exitCode = 68;
    return { file: outcome.path, audiences: outcome.audiences, warnings: outcome.warnings };
  }
}
