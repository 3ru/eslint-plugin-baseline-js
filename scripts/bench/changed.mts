/** bench:changed: whether a change set needs the perf benchmark, by the rules in triggers.mts. */
import { appendFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { CliError, type Options, option, parseCli } from "./cli.mts";
import { git, TRIGGERS_FILE } from "./lib.mts";
import { decide, loadTriggers } from "./triggers.mts";

const LISTED_FILES = 20;

const USAGE = `usage: pnpm bench:changed [options]

Decides whether the changed files need the perf benchmark. A file triggers it unless it is
in ignoreFiles, under an ignoreDirectories entry or ends with an ignoreExtensions entry;
alwaysRun paths trigger it even when an ignore entry matches them.

  --base <ref>              diff base: git diff --name-only --no-renames <base> <head>
                            (locally: --base "$(git merge-base origin/main HEAD)")
  --head <ref>              diff head (default: HEAD)
  --files <a,b>             classify these paths instead of a diff
  --config <file>           trigger rules (default: bench/perf-triggers.json)
  --github-output <file>    append run=<true|false> and reason=<text> for GitHub Actions
  --help                    print this help

Give --base or --files.`;

const OPTIONS = {
  base: option.text(""),
  head: option.text("HEAD"),
  files: option.text(""),
  config: option.text(TRIGGERS_FILE),
  githubOutput: option.text(""),
};

function changedFiles(options: Options<typeof OPTIONS>): string[] {
  if (options.files !== "") {
    return options.files
      .split(",")
      .values()
      .map((file) => file.trim())
      .filter((file) => file !== "")
      .toArray();
  }

  // --no-renames lists both names of a moved file; -z keeps unusual paths unquoted and whole.
  return git(["diff", "--name-only", "--no-renames", "-z", options.base, options.head])
    .split("\0")
    .filter((file) => file !== "");
}

export function main(argv: readonly string[]): void {
  const options = parseCli(argv, OPTIONS, USAGE, (parsed) => {
    if (parsed.base === "" && parsed.files === "") throw new CliError("give --base or --files");

    return parsed;
  });

  const decision = decide(changedFiles(options), loadTriggers(resolve(options.config)));
  console.log(`run=${decision.run}`);
  console.log(decision.reason);

  for (const { file, why } of decision.triggering.slice(0, LISTED_FILES)) {
    console.log(`  ${file}  (${why})`);
  }

  const unlisted = decision.triggering.length - LISTED_FILES;

  if (unlisted > 0) console.log(`  … and ${unlisted} more`);

  if (options.githubOutput !== "") {
    // One line per output: a newline in a path must not start a forged `key=value` line.
    const reason = decision.reason.replace(/[\r\n]+/g, " ");
    appendFileSync(resolve(options.githubOutput), `run=${decision.run}\nreason=${reason}\n`);
  }
}

// Only as a script, so tests can import main(); import.meta.main is missing on Node 24.1.
const entry = process.argv[1];

if (entry !== undefined && realpathSync(entry) === import.meta.filename) {
  main(process.argv.slice(2));
}
