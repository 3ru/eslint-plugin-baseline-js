import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pinned = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const target = join(here, "results", "latest-tools");
// Start from nothing: pnpm would otherwise reuse node_modules/.pnpm/lock.yaml and keep the
// versions of the previous run. The committed manifest, lockfile and install stay untouched.
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, "package.json"),
  `${JSON.stringify(
    {
      private: true,
      packageManager: pinned.packageManager,
      devDependencies: {
        "@typescript-eslint/parser": "latest",
        // Stable Bun has no `bun lint` yet; the daily canary is the only channel that does.
        bun: "canary",
        eslint: "latest",
        oxlint: "latest",
        typescript: pinned.devDependencies.typescript,
      },
    },
    null,
    2,
  )}\n`,
);
const result = spawnSync(
  "pnpm",
  [
    "install",
    "--ignore-scripts",
    "--no-frozen-lockfile",
    "--strict-peer-dependencies",
    // Skip anything published in the last day, so a release pulled for a bad build or a
    // hijacked package is not run in CI the same morning.
    "--config.minimum-release-age=1440",
  ],
  { cwd: target, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
