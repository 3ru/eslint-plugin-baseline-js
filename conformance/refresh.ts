import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { harnessSettings, npmRelease } from "./subject.ts";

const here = dirname(fileURLToPath(import.meta.url));

try {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const target = resolve(values.out ?? join(here, "results", "latest", "tools"));
  mkdirSync(target, { recursive: true });
  if (readdirSync(target).length !== 0)
    throw new Error(`Latest tools output must be empty: ${target}`);
  const tags = {
    "@typescript-eslint/parser": "latest",
    bun: "canary",
    eslint: "latest",
    oxlint: "latest",
  } as const;
  const versions = await Promise.all(
    Object.entries(tags).map(async ([name, tag]) => [name, (await npmRelease(name, tag)).version]),
  );
  const settings = harnessSettings();
  const dependencies = Object.fromEntries([...versions, ["typescript", settings.typescript]]);
  if (!dependencies.bun?.includes("-canary.")) {
    throw new Error(
      `npm bun@canary resolved to ${dependencies.bun}; the lint channel must be a canary.`,
    );
  }
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        packageManager: settings.packageManager,
        devDependencies: dependencies,
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
      "--config.minimum-release-age=0",
    ],
    { cwd: target, stdio: "inherit", timeout: 120000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Cannot install latest tools: ${result.error?.message ?? `pnpm exited ${result.status}`}.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
