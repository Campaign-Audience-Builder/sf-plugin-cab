import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { loadCatalog } from '../../../cab/exporter.js';
import { targetOrgFlag, verboseFlag } from '../../../cab/flags.js';
import { connectCab, orgLine } from '../../../cab/org.js';
import { exportSkips, inFolder, sequenceClosure } from '../../../cab/selection.js';
import { audienceLabel } from '../../../cab/ux.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'cab.audience.list');
const reasons = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'reasons');

export type ListRow = {
  name: string;
  apiName: string | null;
  folder: string | null;
  type: string;
  lastModified: string;
  exportable: boolean;
  reason?: string;
  id?: string;
};

export type ListResult = { org: string; audiences: ListRow[] };

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
    this.spinner.start(messages.getMessage('reading'));
    const cab = await connectCab(flags['target-org']);
    const catalog = await loadCatalog(cab);
    this.spinner.stop();

    // An audience cannot be exported if it has no API name, or if a sequence uses such an audience.
    const all = new Set(catalog.audiences.map((a) => a.id));
    const closure = sequenceClosure(catalog.selectables, all);
    const skips = exportSkips(catalog.selectables, all, closure.cycles);

    const rows: ListRow[] = catalog.audiences
      .filter((a) => !flags.folder?.length || flags.folder.some((f) => inFolder(a.folderPath, f)))
      .map((a) => {
        const skip = skips.get(a.id);
        const cause = skip?.cause ? catalog.byId.get(skip.cause) : undefined;
        return {
          name: a.name,
          apiName: a.apiName,
          folder: a.folderPath,
          type: a.type,
          lastModified: a.lastModified.slice(0, 10),
          exportable: !skip,
          ...(skip
            ? { reason: reasons.getMessage(skip.reason, [cause ? audienceLabel(cause.name, cause.apiName) : '']) }
            : {}),
          ...(flags.verbose ? { id: a.id } : {}),
        };
      })
      .sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.name.localeCompare(b.name));

    this.log(orgLine(cab));
    if (!rows.length) {
      this.log(messages.getMessage('noAudiences', [cab.orgName]));
      return { org: cab.orgName, audiences: rows };
    }
    this.table({
      data: rows.map((r) => ({
        Folder: r.folder ?? '',
        Name: r.name,
        'API name': r.apiName ?? '',
        Type: r.type,
        Modified: r.lastModified,
        Problem: r.reason ?? '',
        ...(flags.verbose ? { Id: r.id } : {}),
      })),
    });
    const blocked = rows.filter((r) => !r.exportable).length;
    this.log(messages.getMessage('summaryLine', [rows.length, cab.orgName, blocked]));
    return { org: cab.orgName, audiences: rows };
  }
}
