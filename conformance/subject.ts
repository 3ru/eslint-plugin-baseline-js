import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type NpmSubject, parseNpmSubject } from "../docs/website/lib/compatibility-report.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const subjectFiles = [
  "subject.json",
  "subject.tgz",
  "package.json",
  "pnpm-lock.yaml",
] as const;
export const frozenInstallArgs = [
  "install",
  "--frozen-lockfile",
  "--ignore-scripts",
  "--strict-peer-dependencies",
  "--config.minimum-release-age=0",
] as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function harnessSettings(): { packageManager: string; eslint: string; typescript: string } {
  const manifest = object(
    JSON.parse(readFileSync(join(here, "package.json"), "utf8")),
    "Harness manifest",
  );
  const dependencies = object(manifest.devDependencies, "Harness dependencies");
  if (
    typeof manifest.packageManager !== "string" ||
    typeof dependencies.eslint !== "string" ||
    typeof dependencies.typescript !== "string"
  ) {
    throw new Error("The harness manifest must pin packageManager, ESLint, and TypeScript.");
  }
  return {
    packageManager: manifest.packageManager,
    eslint: dependencies.eslint,
    typescript: dependencies.typescript,
  };
}

export async function npmRelease(
  name: string,
  tag: string,
): Promise<{ version: string; dist: unknown }> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Cannot resolve ${name}@${tag}: npm returned HTTP ${response.status}.`);
  const release = object(await response.json(), `${name}@${tag}`);
  if (
    release.name !== name ||
    typeof release.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(release.version)
  ) {
    throw new Error(`npm returned invalid package metadata for ${name}@${tag}.`);
  }
  return { version: release.version, dist: release.dist };
}

export function verifySubjectArchive(subject: NpmSubject, archive: Uint8Array): void {
  const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (actual !== subject.integrity) {
    throw new Error(
      `Subject archive integrity mismatch for eslint-plugin-baseline-js@${subject.version}. Download ${subject.tarball} again.`,
    );
  }
}

export function readSubject(directory: string): NpmSubject {
  const subject = parseNpmSubject(
    JSON.parse(readFileSync(join(directory, "subject.json"), "utf8")),
  );
  const manifest = object(
    JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
    "Subject manifest",
  );
  const dependencies = object(manifest.dependencies, "Subject dependencies");
  if (dependencies["eslint-plugin-baseline-js"] !== "file:./subject.tgz") {
    throw new Error(
      "The subject manifest must install eslint-plugin-baseline-js from file:./subject.tgz.",
    );
  }
  verifySubjectArchive(subject, readFileSync(join(directory, "subject.tgz")));
  return subject;
}

export function copySubject(source: string, target: string): NpmSubject {
  const subject = readSubject(source);
  mkdirSync(target, { recursive: true });
  for (const file of subjectFiles) copyFileSync(join(source, file), join(target, file));
  return subject;
}

export async function prepareSubject(output: string): Promise<NpmSubject> {
  mkdirSync(output, { recursive: true });
  if (readdirSync(output).length !== 0) throw new Error(`Subject output must be empty: ${output}`);
  const release = await npmRelease("eslint-plugin-baseline-js", "latest");
  const dist = object(release.dist, "npm dist");
  const subject = parseNpmSubject({
    kind: "npm",
    version: release.version,
    tarball: dist.tarball,
    integrity: dist.integrity,
    resolvedAt: new Date().toISOString(),
  });
  const response = await fetch(subject.tarball, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Cannot download subject archive: npm returned HTTP ${response.status}.`);
  const archive = new Uint8Array(await response.arrayBuffer());
  verifySubjectArchive(subject, archive);
  const settings = harnessSettings();
  writeFileSync(join(output, "subject.tgz"), archive);
  writeFileSync(join(output, "subject.json"), `${JSON.stringify(subject, null, 2)}\n`);
  writeFileSync(
    join(output, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        packageManager: settings.packageManager,
        dependencies: {
          "eslint-plugin-baseline-js": "file:./subject.tgz",
          eslint: settings.eslint,
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
      "--lockfile-only",
      "--ignore-scripts",
      "--strict-peer-dependencies",
      "--config.minimum-release-age=0",
    ],
    { cwd: output, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error || result.status !== 0) {
    throw new Error(
      `Cannot prepare the shared subject lock: ${result.error?.message ?? `pnpm exited ${result.status}`}.`,
    );
  }
  return subject;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { out: { type: "string" } } });
    if (!values.out) throw new Error("Usage: node conformance/subject.ts --out <empty-directory>");
    const subject = await prepareSubject(resolve(values.out));
    console.log(`Prepared eslint-plugin-baseline-js@${subject.version} in ${resolve(values.out)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
