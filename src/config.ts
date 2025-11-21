export type EnvOption = "browser" | "worker" | "node";

/**
 * Named constants for Baseline string options.
 * Prefer using these to avoid typos in user configs.
 */
export const BASELINE = {
  WIDELY: "widely",
  NEWLY: "newly",
} as const;

/** String-only Baseline names*/
export type BaselineName = (typeof BASELINE)[keyof typeof BASELINE];

/** Final option type: the named baseline or a year (YYYY) */
export type BaselineOption = BaselineName | number; // YYYY

export interface CommonRuleOptions {
  baseline?: BaselineOption;
  available?: BaselineOption; // alias (optional)
  env?: EnvOption;
  filePattern?: RegExp; // file name pattern to match, default: /\.(?:[mc]?[jt]s|[jt]sx)$/i
  tsAware?: boolean;
  failOn?: "limited" | "newly" | "all";
  // Ignore options (rule-specific). Strings beginning and ending with '/' are treated as regex.
  ignoreFeatures?: string[]; // web-features feature IDs to ignore (e.g., ['nullish-coalescing'])
  ignoreNodeTypes?: string[]; // ESTree node.type to ignore (e.g., ['WithStatement'])
  // Feature usage detection (opt-in)
  includeWebApis?:
    | boolean
    | {
        preset?: "auto" | "safe" | "type-aware" | "heuristic";
        useTypes?: "off" | "auto" | "require";
        heuristics?: "off" | "conservative" | "aggressive";
        only?: string[];
        ignore?: string[];
      };
  includeJsBuiltins?:
    | boolean
    | {
        preset?: "auto" | "safe" | "type-aware" | "heuristic";
        useTypes?: "off" | "auto" | "require";
        heuristics?: "off" | "conservative" | "aggressive";
        only?: string[];
        ignore?: string[];
      };
}

export function getBaselineValue(opt: CommonRuleOptions | undefined): BaselineOption {
  if (!opt) return BASELINE.WIDELY;
  // Prefer the new 'available' option name; keep 'baseline' as a backward-compatible alias.
  // TODO: Remove 'baseline' in the next major version.
  return opt.available ?? opt.baseline ?? BASELINE.WIDELY;
}
