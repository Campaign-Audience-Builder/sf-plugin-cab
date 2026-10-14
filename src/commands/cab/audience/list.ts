import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { targetOrgFlag, verboseFlag } from '../../../cab/flags.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.list');

export type ListResult = {
  org: string;
  audiences: Array<{
    name: string;
    apiName: string | null;
    folder: string | null;
    type: string | null;
    lastModified: string;
    exportable: boolean;
    reason?: string;
  }>;
};

export default class AudienceList extends SfCommand<ListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': targetOrgFlag,
    folder: Flags.string({ summary: messages.getMessage('flags.folder.summary'), multiple: true }),
    verbose: verboseFlag,
  };

  public async run(): Promise<ListResult> {
    const { flags } = await this.parse(AudienceList);
    return { org: flags['target-org'].getUsername() ?? '', audiences: [] };
  }
}
