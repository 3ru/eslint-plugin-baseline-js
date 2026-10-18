import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pinned = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const target = join(here, "results", "latest-tools");
mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, "package.json"),
  `${JSON.stringify(
    {
      private: true,
      packageManager: "pnpm@10.34.5",
      devDependencies: {
        "@typescript-eslint/parser": "latest",
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
// Only the generated installation is refreshed; committed pins remain untouched.
rmSync(join(target, "pnpm-lock.yaml"), { force: true });
const result = spawnSync(
  "pnpm",
  [
    "install",
    "--ignore-scripts",
    "--no-prefer-frozen-lockfile",
    "--no-frozen-lockfile",
    "--strict-peer-dependencies",
    "--prefer-offline=false",
  ],
  {
    cwd: target,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
