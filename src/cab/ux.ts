/** True if the command can ask questions: a terminal on both sides, and no --json. */
export function isInteractive(json: boolean): boolean {
  return !json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

/** "Spring Promo (Spring_Promo_x3k9a)". Messages name each audience by name and API name. */
export function audienceLabel(name: string, apiName: string | null): string {
  return apiName && apiName !== name ? `${name} (${apiName})` : name;
}

/** Shows at most `max` items, and a line that tells how many more there are. */
export function limitLines(lines: string[], verbose: boolean, max = 10): string[] {
  if (verbose || lines.length <= max) return lines;
  return [...lines.slice(0, max), `… and ${lines.length - max} more (show all: --verbose)`];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
