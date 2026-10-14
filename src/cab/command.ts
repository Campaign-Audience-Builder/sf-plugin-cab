import { SfCommand } from '@salesforce/sf-plugins-core';

/** The base of the cab commands: no stack trace unless the admin gives --verbose (6.3). */
export abstract class CabCommand<T> extends SfCommand<T> {
  /** The error JSON of --json has a stack trace and a cause with a stack trace. Remove both without --verbose. */
  public logJson(json: unknown): void {
    if (!this.verbose() && json && typeof json === 'object' && 'stack' in json) {
      const rest = { ...(json as Record<string, unknown>) };
      delete rest.stack;
      delete rest.cause;
      return super.logJson(rest);
    }
    return super.logJson(json);
  }

  protected async catch(error: Error): Promise<never> {
    if (this.verbose() && error.stack) this.logToStderr(error.stack);
    return super.catch(error);
  }

  private verbose(): boolean {
    return this.argv.includes('--verbose');
  }
}
