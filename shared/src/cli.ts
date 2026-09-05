// Pure, no dependencies. Shared by any script that takes `--flag value`
// style CLI args, so the parsing itself is unit tested once instead of
// re-implemented (and re-risked) per script — see shared/test/cli.test.ts.

/**
 * Parses `--flag value --other-flag value2` style argv into a flat record.
 * A flag with no following value (either it's the last arg, or the next arg
 * also starts with `--`) gets an empty string, not `undefined` — callers
 * that need to distinguish "flag present but empty" from "flag absent"
 * should treat `""` as "no real value provided", matching how
 * 03-set-compliance.ts already filters values before this extraction.
 */
export function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current?.startsWith("--")) {
      const next = argv[i + 1];
      const hasValue = next !== undefined && !next.startsWith("--");
      out[current.slice(2)] = hasValue ? next : "";
      if (hasValue) i++;
    }
  }
  return out;
}
