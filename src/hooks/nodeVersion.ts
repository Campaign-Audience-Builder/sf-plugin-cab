import type { Hook } from '@oclif/core';

/** The Node version that the sf CLI libraries of this plugin need. */
export const MIN_NODE_MAJOR = 22;

/**
 * An old sf CLI runs plugins with an old Node version, and then the plugin crashes with a stack trace.
 * This hook stops a cab command first, with a message that tells the admin to update the sf CLI.
 * It imports nothing else, so it works on an old Node version.
 */
// eslint-disable-next-line @typescript-eslint/require-await
const hook: Hook.Init = async function (options) {
  // The init hook runs before oclif loads the command, so the crash cannot happen first.
  if (!options.id?.startsWith('cab')) return;
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    this.error(
      `This plugin needs an sf CLI that uses Node ${MIN_NODE_MAJOR} or newer, but your sf CLI uses Node ${process.versions.node}. Update the sf CLI: sf update`,
      { exit: 1 }
    );
  }
};

export default hook;
