import { Messages, Org, SfError } from '@salesforce/core';
import { Flags } from '@salesforce/sf-plugins-core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@campaign-audience-builder/sf-plugin-cab', 'shared');

/**
 * Resolves an org alias or username. The error tells the admin how to log in,
 * because the default sf CLI error does not name the login command.
 */
export async function resolveOrg(aliasOrUsername?: string): Promise<Org> {
  if (!aliasOrUsername) {
    try {
      return await Org.create({});
    } catch {
      throw new SfError(messages.getMessage('error.noDefaultOrg'), 'NoDefaultOrg', messages.getMessages('error.noDefaultOrg.actions'));
    }
  }
  try {
    return await Org.create({ aliasOrUsername });
  } catch {
    throw new SfError(
      messages.getMessage('error.orgNotFound', [aliasOrUsername]),
      'OrgNotFound',
      messages.getMessages('error.orgNotFound.actions', [aliasOrUsername])
    );
  }
}

const orgFlag = Flags.custom<Org>({
  parse: async (input: string) => resolveOrg(input),
});

export const targetOrgFlag = orgFlag({
  char: 'o',
  summary: messages.getMessage('flags.target-org.summary'),
  required: true,
  default: async () => resolveOrg(),
  defaultHelp: () => Promise.resolve('the default org of the sf CLI'),
});

export const verboseFlag = Flags.boolean({
  summary: messages.getMessage('flags.verbose.summary'),
  default: false,
});

export { orgFlag };

export const missingOptions = ['create', 'skip', 'fail'] as const;
export type MissingAnswer = (typeof missingOptions)[number];
