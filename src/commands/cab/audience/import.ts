import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { missingOptions, targetOrgFlag, verboseFlag } from '../../../cab/flags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.import');

export const importFlags = {
  'dry-run': Flags.boolean({ char: 'd', summary: messages.getMessage('flags.dry-run.summary') }),
  yes: Flags.boolean({ char: 'y', summary: messages.getMessage('flags.yes.summary') }),
  'fail-fast': Flags.boolean({ summary: messages.getMessage('flags.fail-fast.summary') }),
  'missing-folders': Flags.option({
    options: missingOptions,
    summary: messages.getMessage('flags.missing-folders.summary'),
  })(),
  'missing-templates': Flags.option({
    options: missingOptions,
    summary: messages.getMessage('flags.missing-templates.summary'),
  })(),
  'missing-outcomes': Flags.option({
    options: missingOptions,
    summary: messages.getMessage('flags.missing-outcomes.summary'),
  })(),
};

export type ImportResult = {
  audiences: Array<{ name: string; apiName: string; status: string; reason?: string; targetId?: string }>;
};

export default class AudienceImport extends SfCommand<ImportResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': targetOrgFlag,
    file: Flags.file({ char: 'f', summary: messages.getMessage('flags.file.summary'), required: true, exists: true }),
    ...importFlags,
    verbose: verboseFlag,
  };

  public async run(): Promise<ImportResult> {
    await this.parse(AudienceImport);
    return { audiences: [] };
  }
}
