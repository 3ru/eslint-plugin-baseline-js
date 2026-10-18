/** Which changed files need the perf benchmark, by the rules in bench/perf-triggers.json. */
import { z } from "zod";
import { readJsonFile } from "./lib.mts";
import type { PerfTriggers } from "./types.mts";

const REASON_EXAMPLES = 5;

export const PerfTriggersSchema = z.object({
  $comment: z.string().optional(),
  ignoreDirectories: z.array(z.string()),
  ignoreExtensions: z.array(z.string()),
  ignoreFiles: z.array(z.string()),
  alwaysRun: z.array(z.string()),
});

export function loadTriggers(file: string): PerfTriggers {
  return readJsonFile(file, PerfTriggersSchema);
}

/** Repository-relative POSIX form, as git prints paths. */
function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

/** An entry ending in "/" names a directory and matches everything under it. */
function matchesEntry(path: string, entry: string): boolean {
  const normalized = normalize(entry);

  return normalized.endsWith("/") ? path.startsWith(normalized) : path === normalized;
}

/** Why a changed file triggers the benchmark, or null when the rules ignore it. */
export function classify(path: string, triggers: PerfTriggers): string | null {
  const file = normalize(path);
  const always = triggers.alwaysRun.find((entry) => matchesEntry(file, entry));

  // alwaysRun wins over every ignore rule (bench/ holds .md files, .github/ holds perf.yml).
  if (always !== undefined) return `always runs for ${always}`;

  if (triggers.ignoreFiles.some((entry) => normalize(entry) === file)) return null;

  if (triggers.ignoreDirectories.some((entry) => file.startsWith(normalize(entry)))) return null;
  const lower = file.toLowerCase();

  if (triggers.ignoreExtensions.some((extension) => lower.endsWith(extension.toLowerCase()))) {
    return null;
  }

  return "code or build input";
}

export interface Trigger {
  file: string;
  why: string;
}

export interface Decision {
  run: boolean;
  /** One line that reads after "Triggered because". */
  reason: string;
  triggering: Trigger[];
}

function files(count: number): string {
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

export function decide(changedFiles: readonly string[], triggers: PerfTriggers): Decision {
  const triggering = changedFiles.flatMap((file) => {
    const why = classify(file, triggers);

    return why === null ? [] : [{ file, why }];
  });

  if (triggering.length > 0) {
    const examples = triggering.slice(0, REASON_EXAMPLES).map((trigger) => trigger.file);
    const more = triggering.length > REASON_EXAMPLES ? ", …" : "";
    const verb = triggering.length === 1 ? "affects" : "affect";

    return {
      run: true,
      reason: `${triggering.length} of ${files(changedFiles.length)} ${verb} the rule or its build (first: ${examples.join(", ")}${more})`,
      triggering,
    };
  }

  if (changedFiles.length === 0) return { run: false, reason: "no changed files", triggering };

  if (changedFiles.length === 1) {
    return {
      run: false,
      reason: "the only changed file is documentation, a test or another ignored path",
      triggering,
    };
  }

  return {
    run: false,
    reason: `all ${files(changedFiles.length)} are documentation, tests or other ignored paths`,
    triggering,
  };
}
