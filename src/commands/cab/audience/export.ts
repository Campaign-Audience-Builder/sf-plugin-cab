import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { targetOrgFlag, verboseFlag } from '../../../cab/flags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.export');

export type ExportResult = {
  file: string;
  audiences: Array<{ name: string; apiName: string; status: 'exported' | 'skipped'; reason?: string }>;
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
    await this.parse(AudienceExport);
    return { file: '', audiences: [] };
  }
}
