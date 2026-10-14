import { SfCommand } from '@salesforce/sf-plugins-core';

/** The base of the cab commands: no stack trace unless the admin gives --verbose (6.3). */
export abstract class CabCommand<T> extends SfCommand<T> {
  protected async catch(error: Error): Promise<never> {
    if (this.argv.includes('--verbose')) {
      if (error.stack) this.logToStderr(error.stack);
    } else {
      error.stack = undefined;
    }
    return super.catch(error);
  }
}
