import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { missingOptions, targetOrgFlag, verboseFlag } from '../../../cab/flags.js';
import { readExportFile } from '../../../cab/importFile.js';
import { ImportOutcome, runImportFlow } from '../../../cab/importFlow.js';
import { connectCab } from '../../../cab/org.js';

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

export type ImportResult = ImportOutcome;

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
    const { flags } = await this.parse(AudienceImport);
    const file = await readExportFile(flags.file);
    const cab = await connectCab(flags['target-org']);
    const outcome = await runImportFlow(this, cab, flags.file, file, {
      dryRun: flags['dry-run'],
      yes: flags.yes,
      failFast: flags['fail-fast'],
      missingFolders: flags['missing-folders'],
      missingTemplates: flags['missing-templates'],
      missingOutcomes: flags['missing-outcomes'],
      verbose: flags.verbose,
      json: this.jsonEnabled(),
      pluginVersion: this.config.pjson.version,
      rerunCommand: `sf cab audience import -o ${cab.alias} --file ${flags.file}`,
    });
    process.exitCode = outcome.exitCode;
    return outcome;
  }
}
