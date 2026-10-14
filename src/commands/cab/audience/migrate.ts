import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { orgFlag, verboseFlag } from '../../../cab/flags.js';
import AudienceExport from './export.js';
import { importFlags, ImportResult } from './import.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.migrate');

export type MigrateResult = ImportResult & { file: string };

export default class AudienceMigrate extends SfCommand<MigrateResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'source-org': orgFlag({ summary: messages.getMessage('flags.source-org.summary'), required: true }),
    'target-org': orgFlag({ char: 'o', summary: messages.getMessage('flags.target-org.summary'), required: true }),
    all: AudienceExport.flags.all,
    name: AudienceExport.flags.name,
    folder: AudienceExport.flags.folder,
    'output-file': Flags.file({ summary: messages.getMessage('flags.output-file.summary') }),
    ...importFlags,
    verbose: verboseFlag,
  };

  public async run(): Promise<MigrateResult> {
    await this.parse(AudienceMigrate);
    return { file: '', audiences: [] };
  }
}
