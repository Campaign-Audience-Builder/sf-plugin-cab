import { Messages, SfError } from '@salesforce/core';
import { Flags } from '@salesforce/sf-plugins-core';
import { CabCommand } from '../../../cab/command.js';
import { runExport } from '../../../cab/exportFlow.js';
import { orgFlag, verboseFlag } from '../../../cab/flags.js';
import { runImportFlow } from '../../../cab/importFlow.js';
import { connectCab } from '../../../cab/org.js';
import AudienceExport from './export.js';
import { importFlags, ImportResult } from './import.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.migrate');

export type MigrateResult = ImportResult & { file: string; exportWarnings: string[] };

export default class AudienceMigrate extends CabCommand<MigrateResult> {
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
    const { flags } = await this.parse(AudienceMigrate);
    const [source, target] = await Promise.all([connectCab(flags['source-org']), connectCab(flags['target-org'])]);
    if (source.orgId === target.orgId) {
      throw new SfError(messages.getMessage('error.sameOrg'), 'SameOrg', messages.getMessages('error.sameOrg.actions'));
    }
    const exported = await runExport(this, source, {
      all: flags.all,
      names: flags.name,
      folders: flags.folder,
      outputFile: flags['output-file'],
      overwrite: false,
      verbose: flags.verbose,
      json: this.jsonEnabled(),
      pluginVersion: this.config.pjson.version,
    });
    this.log('');
    const outcome = await runImportFlow(this, target, exported.path, exported.file, {
      dryRun: flags['dry-run'],
      yes: flags.yes,
      failFast: flags['fail-fast'],
      missingFolders: flags['missing-folders'],
      missingTemplates: flags['missing-templates'],
      missingOutcomes: flags['missing-outcomes'],
      verbose: flags.verbose,
      json: this.jsonEnabled(),
      pluginVersion: this.config.pjson.version,
      rerunCommand: `sf cab audience import -o ${target.alias} --file ${exported.path}`,
    });
    // Audiences that the export skipped count as skipped for the exit code.
    process.exitCode = exported.partial && outcome.exitCode === 0 ? 68 : outcome.exitCode;
    return { ...outcome, file: exported.path, exportWarnings: exported.warnings };
  }
}
