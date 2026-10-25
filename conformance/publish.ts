import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  hosts,
  type Manifest,
  type NpmSubject,
  type Profile,
  type ProfileMeasurement,
  type PublicCase,
  parseManifest,
  parseNpmSubject,
  parseProfileMeasurement,
  parseRunIdentity,
  profiles,
  type Reference,
  type RunIdentity,
  renderSnapshotMarkdown,
  reportBranch,
  type Snapshot,
} from "../docs/website/lib/compatibility-report.ts";
import { cases } from "./cases.ts";

type JobSource = { attempt: number; conclusion: string };
export interface PublishOptions {
  inputDirectory: string;
  repositoryDirectory: string;
  run: RunIdentity;
  sources: {
    prepare: JobSource | null;
    profiles: Record<Profile, JobSource | null>;
  };
  remote?: string;
}

export interface Publication {
  manifest: Manifest;
  snapshotCommit: string;
  published: boolean;
}

const textLimit = 2 * 1024 * 1024;
const fileLimit = 512;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const problem = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const catalog: PublicCase[] = cases.map(({ id, label, suite }) => ({ id, label, suite }));

function parseSources(input: unknown, run: RunIdentity): PublishOptions["sources"] {
  if (!Array.isArray(input)) throw new Error("The trusted jobs input must be a JSON array.");
  const sources: PublishOptions["sources"] = {
    prepare: null,
    profiles: { pinned: null, latest: null },
  };
  for (const job of input) {
    if (
      typeof job !== "object" ||
      job === null ||
      !("run_id" in job) ||
      String(job.run_id) !== run.id ||
      !("name" in job)
    ) {
      continue;
    }
    const profile = profiles.find((profile) => job.name === `Measure (${profile})`);
    if (job.name !== "Resolve released plugin" && !profile) continue;
    if (
      !("run_attempt" in job) ||
      typeof job.run_attempt !== "number" ||
      !Number.isSafeInteger(job.run_attempt) ||
      job.run_attempt < 1
    ) {
      throw new Error("A trusted producer job has an invalid run_attempt.");
    }
    if (job.run_attempt > run.attempt) continue;
    if (!("conclusion" in job) || typeof job.conclusion !== "string" || !job.conclusion) {
      throw new Error("A trusted producer job must have a completed conclusion.");
    }
    const source = { attempt: job.run_attempt, conclusion: job.conclusion };
    const previous = profile ? sources.profiles[profile] : sources.prepare;
    if (!previous || source.attempt > previous.attempt) {
      if (profile) sources.profiles[profile] = source;
      else sources.prepare = source;
    }
  }
  return sources;
}

async function readText(path: string, limit = textLimit): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Evidence must be a regular file, not a symlink.");
  if (metadata.size > limit) throw new Error(`Evidence exceeds the ${limit}-byte limit.`);
  const bytes = await readFile(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("Binary evidence is not allowed.");
  return text;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path, 256 * 1024);
  return artifactJson(text, basename(path));
}

function artifactJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} contains invalid JSON.`);
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function allowedEvidence(path: string): boolean {
  if (/^(?:report\.(?:json|md)|profile\.json|identity\.json)$/.test(path)) return true;
  if (/^tools\/(?:package\.json|pnpm-lock\.yaml)$/.test(path)) return true;
  if (/^raw\/[a-z0-9.-]+\.(?:stdout|stderr)$/.test(path)) return true;
  if (path === "work/tsconfig.json") return true;
  const fixture =
    /^work\/([a-z][a-z0-9-]*)\/(input\.(?:js|ts)|eslint\.config\.mjs|\.oxlintrc\.json)$/.exec(path);
  return fixture !== null && cases.some(({ id }) => id === fixture[1]);
}

async function collectEvidence(directory: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let size = 0;
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Evidence contains a symlink.");
      if (entry.isDirectory()) {
        if (/^(?:raw|tools|work)(?:\/[a-z][a-z0-9-]*)?$/.test(path)) await visit(path);
        continue;
      }
      if (!allowedEvidence(path)) continue;
      const text = await readText(join(directory, path));
      size += Buffer.byteLength(text);
      if (size > textLimit || files.size >= fileLimit)
        throw new Error("Profile evidence exceeds the publication limit.");
      files.set(path, text);
    }
  };
  await visit("");
  return files;
}

type LocalPath = { path: string; placeholder: string };

function normalizePaths(paths: readonly LocalPath[]): (text: string) => string {
  const substitutions = paths
    .flatMap(({ path, placeholder }) => {
      const pattern = (prefix: string): RegExp =>
        new RegExp(
          `${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[/\\s"':),;\\]}>\\x60])`,
          "g",
        );
      return [
        { prefix: pathToFileURL(path).href, replacement: `file://${placeholder}` },
        { prefix: path, replacement: placeholder },
      ].flatMap(({ prefix, replacement }) =>
        [...new Set([prefix, JSON.stringify(prefix).slice(1, -1)])].map((form) => ({
          prefix: form,
          expression: pattern(form),
          replacement,
        })),
      );
    })
    .sort((left, right) => right.prefix.length - left.prefix.length);
  return (text) =>
    substitutions.reduce(
      (result, { expression, replacement }) => result.replace(expression, () => replacement),
      text,
    );
}

function verifyRun(input: unknown, run: RunIdentity, attempt: number): void {
  const actual = parseRunIdentity(input);
  if (
    actual.repository !== run.repository ||
    actual.id !== run.id ||
    actual.number !== run.number ||
    actual.commit !== run.commit ||
    actual.attempt !== attempt ||
    actual.attempt > run.attempt
  ) {
    throw new Error("Artifact identity does not match this workflow run and source job attempt.");
  }
}

function verifyIdentity(
  input: unknown,
  run: RunIdentity,
  profile: Profile,
  subject: NpmSubject,
  attempt: number,
): LocalPath[] {
  if (
    typeof input !== "object" ||
    input === null ||
    !("run" in input) ||
    !("profile" in input) ||
    !("subject" in input) ||
    !("paths" in input)
  ) {
    throw new Error("identity.json must contain run, profile, subject, and local paths.");
  }
  verifyRun(input.run, run, attempt);
  if (input.profile !== profile || json(parseNpmSubject(input.subject)) !== json(subject)) {
    throw new Error("Artifact identity does not match this profile and npm release.");
  }
  if (typeof input.paths !== "object" || input.paths === null)
    throw new Error("identity.paths must be an object.");
  const paths = input.paths;
  return Object.entries({
    repository: "<repository>",
    output: "<profile>",
    home: "<home>",
    node: "<node>",
  }).map(([key, placeholder]) => {
    const path: unknown = Reflect.get(paths, key);
    if (
      typeof path !== "string" ||
      !isAbsolute(path) ||
      normalize(path) !== path ||
      path === "/" ||
      /[\0\r\n]/.test(path)
    ) {
      throw new Error(`identity.paths.${key} must be a specific absolute local path.`);
    }
    return { path, placeholder };
  });
}

async function collect({
  inputDirectory,
  repositoryDirectory,
  run,
  sources,
}: PublishOptions): Promise<{ snapshot: Snapshot; files: Map<string, string> }> {
  const files = new Map<string, string>();
  const paths: LocalPath[] = [
    { path: resolve(inputDirectory), placeholder: "<artifact>" },
    { path: resolve(repositoryDirectory), placeholder: "<repository>" },
    { path: homedir(), placeholder: "<home>" },
    { path: process.execPath, placeholder: "<node>" },
  ];
  let normalizeText = normalizePaths(paths);
  let subject: Snapshot["subject"];
  try {
    if (sources.prepare?.conclusion !== "success") {
      throw new Error(
        sources.prepare
          ? `The prepare job concluded ${sources.prepare.conclusion}.`
          : "No trusted prepare job was found.",
      );
    }
    const context = await readText(join(inputDirectory, "context.json"), 256 * 1024);
    verifyRun(artifactJson(context, "context.json"), run, sources.prepare.attempt);
    const subjectDirectory = await lstat(join(inputDirectory, "subject"));
    if (!subjectDirectory.isDirectory() || subjectDirectory.isSymbolicLink())
      throw new Error("Subject evidence must be a directory, not a symlink.");
    subject = parseNpmSubject(await readJson(join(inputDirectory, "subject", "subject.json")));
    for (const name of ["subject.json", "package.json", "pnpm-lock.yaml"]) {
      files.set(`subject/${name}`, await readText(join(inputDirectory, "subject", name)));
    }
    files.set("subject/context.json", context);
    if ([...files.values()].reduce((size, text) => size + Buffer.byteLength(text), 0) > textLimit) {
      throw new Error("Subject evidence exceeds the publication limit.");
    }
  } catch (error) {
    subject = {
      kind: "unresolved",
      reason: `Subject preparation failed. ${missing(error) ? "The npm subject files are missing." : normalizeText(problem(error))}`,
    };
    files.clear();
  }
  const collectProfile = async (profile: Profile): Promise<ProfileMeasurement> => {
    if (subject.kind === "unresolved") return { kind: "not-measured", reason: subject.reason };
    const source = sources.profiles[profile];
    if (!source || source.conclusion === "skipped") {
      return {
        kind: "not-measured",
        reason: source
          ? `The ${profile} collector was skipped.`
          : `No trusted ${profile} collector job was found.`,
      };
    }
    try {
      const directory = join(inputDirectory, profile);
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
        throw new Error("Profile evidence must be a directory, not a symlink.");
      paths.push(
        ...verifyIdentity(
          await readJson(join(directory, "identity.json")),
          run,
          profile,
          subject,
          source.attempt,
        ),
      );
      normalizeText = normalizePaths(paths);
      const measurement = parseProfileMeasurement(
        artifactJson(
          normalizeText(await readText(join(directory, "profile.json"), 256 * 1024)),
          "profile.json",
        ),
        catalog,
      );
      const evidence = await collectEvidence(directory);
      if (
        measurement.kind === "measured" &&
        ["report.json", "tools/package.json", "tools/pnpm-lock.yaml"].some(
          (path) => !evidence.has(path),
        )
      ) {
        throw new Error(
          "Measured profiles require report.json and the tool package.json and pnpm-lock.yaml for reproduction.",
        );
      }
      if (measurement.kind === "measured") {
        for (const host of hosts) {
          const result = measurement.hosts[host];
          if (result.kind === "not-measured") continue;
          for (const [id, row] of Object.entries(result.cases)) {
            if (
              row.kind === "observed" &&
              ["stdout", "stderr"].some(
                (stream) => !evidence.has(`raw/${host}-${id}-inspect.${stream}`),
              )
            ) {
              result.cases[id] = {
                kind: "not-measured",
                reason: "The collected case has no complete stdout and stderr evidence.",
              };
            }
          }
        }
      }
      const currentBytes = [...files.values()].reduce(
        (total, text) => total + Buffer.byteLength(text),
        0,
      );
      const profileBytes = [...evidence.values()].reduce(
        (total, text) => total + Buffer.byteLength(text),
        0,
      );
      if (currentBytes + profileBytes > textLimit)
        throw new Error("Paired evidence exceeds the 2 MiB publication limit.");
      for (const [path, text] of evidence) files.set(`${profile}/${path}`, text);
      return measurement;
    } catch (error) {
      return {
        kind: "not-measured",
        reason: `${
          missing(error)
            ? `The ${profile} collector produced no complete artifact.`
            : `The ${profile} artifact was rejected. ${normalizeText(problem(error))}`
        } Collector job conclusion was ${source.conclusion}.`,
      };
    }
  };
  const snapshot: Snapshot = {
    schemaVersion: 1,
    run,
    subject,
    cases: catalog,
    profiles: { pinned: await collectProfile("pinned"), latest: await collectProfile("latest") },
  };
  for (const [path, text] of files) files.set(path, normalizeText(text));
  const writeSummary = (): void => {
    files.set("report.json", json(snapshot));
    files.set("report.md", renderSnapshotMarkdown({ snapshot, evidenceBaseUrl: "" }));
  };
  const exceedsLimit = (): boolean =>
    [...files.values()].reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) > textLimit;
  writeSummary();
  for (const profile of [...profiles].reverse()) {
    if (!exceedsLimit()) break;
    snapshot.profiles[profile] = {
      kind: "not-measured",
      reason: "The paired report and evidence exceed the 2 MiB publication limit.",
    };
    for (const path of files.keys()) if (path.startsWith(`${profile}/`)) files.delete(path);
    writeSummary();
  }
  if (exceedsLimit()) {
    files.clear();
    snapshot.subject = {
      kind: "unresolved",
      reason: "The subject evidence exceeds the publication limit with the report summary.",
    };
    writeSummary();
  }
  return { snapshot, files };
}

function complete(snapshot: Snapshot): boolean {
  return (
    snapshot.subject.kind === "npm" &&
    profiles.every((profile) => {
      const measurement = snapshot.profiles[profile];
      return (
        measurement.kind === "measured" &&
        hosts.every((host) => {
          const result = measurement.hosts[host];
          return (
            result.kind === "measured" &&
            Object.values(result.cases).every(
              (row) =>
                row.kind === "observed" &&
                row.capability !== "unknown" &&
                row.status !== "unknown" &&
                row.status !== "execution-error",
            )
          );
        })
      );
    })
  );
}

function newer(candidate: Reference, current: Reference | null): boolean {
  if (!current) return true;
  if (candidate.runNumber === current.runNumber && candidate.runId !== current.runId) {
    throw new Error("Different run IDs have the same workflow run number.");
  }
  return (
    candidate.runNumber > current.runNumber ||
    (candidate.runNumber === current.runNumber && candidate.attempt > current.attempt)
  );
}

class GitFailure extends Error {
  readonly exitCode: number;
  constructor(operation: string, exitCode: number) {
    super(
      `Git ${operation} failed with exit code ${exitCode}. Check the repository, remote access, and branch permissions.`,
    );
    this.exitCode = exitCode;
  }
}

export async function publish(options: PublishOptions): Promise<Publication> {
  const run = parseRunIdentity(options.run);
  const remote = options.remote ?? "origin";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(remote) && !isAbsolute(remote)) {
    throw new Error("Use a configured Git remote name or an absolute local bare repository path.");
  }
  const { snapshot, files } = await collect({ ...options, run });
  const temporary = await mkdtemp(join(tmpdir(), "conformance-publish-"));
  const git = (args: string[], input?: string): Promise<string> =>
    new Promise((resolveCommand, reject) => {
      const child = execFile(
        "git",
        ["-c", "core.hooksPath=/dev/null", "-C", options.repositoryDirectory, ...args],
        {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 60000,
          env: {
            ...process.env,
            GIT_INDEX_FILE: join(temporary, "index"),
            GIT_AUTHOR_NAME: "Toolchain reports",
            GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
            GIT_COMMITTER_NAME: "Toolchain reports",
            GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
            GIT_AUTHOR_DATE: run.startedAt,
            GIT_COMMITTER_DATE: run.startedAt,
            GIT_TERMINAL_PROMPT: "0",
          },
        },
        (error, stdout) => {
          if (error)
            reject(
              new GitFailure(
                args[0] ?? "command",
                typeof error.code === "number" ? error.code : -1,
              ),
            );
          else resolveCommand(stdout.trimEnd());
        },
      );
      child.stdin?.end(input);
    });
  const remoteHead = async (): Promise<string | null> => {
    try {
      const result = await git([
        "ls-remote",
        "--exit-code",
        "--refs",
        remote,
        `refs/heads/${reportBranch}`,
      ]);
      const commit = result.split("\t")[0];
      if (!commit || !/^[0-9a-f]{40}$/.test(commit))
        throw new Error("The report branch returned an invalid Git commit.");
      return commit;
    } catch (error) {
      if (error instanceof GitFailure && error.exitCode === 2) return null;
      throw error;
    }
  };
  const put = async (entries: Map<string, string>): Promise<void> => {
    const paths = [...entries.keys()];
    const inputs = [...entries.values()].map((text, index) => ({
      path: join(temporary, `${index}.txt`),
      text,
    }));
    for (const { path, text } of inputs) await writeFile(path, text);
    const blobs = (
      await git(["hash-object", "-w", "--no-filters", "--", ...inputs.map(({ path }) => path)])
    ).split("\n");
    await git(
      ["update-index", "--index-info"],
      paths.map((path, index) => `100644 ${blobs[index]}\t${path}\n`).join(""),
    );
  };
  const directory = `runs/${run.id}/${run.attempt}`;
  try {
    if ((await git(["rev-parse", "HEAD"])) !== run.commit)
      throw new Error("The publisher checkout must match the workflow harness commit.");
    for (let attempt = 0; attempt < 4; attempt++) {
      const base = await remoteHead();
      let manifest: Manifest | null = null;
      if (base) {
        await git(["fetch", "--no-tags", "--no-write-fetch-head", remote, base]);
        await git(["read-tree", base]);
        manifest = parseManifest(JSON.parse(await git(["show", `${base}:latest.json`])));
        await git(["rm", "--cached", "--force", "-r", "--ignore-unmatch", "--", directory]);
      } else {
        await git(["read-tree", "--empty"]);
      }
      const entries = new Map([...files].map(([path, text]) => [`${directory}/${path}`, text]));
      entries.set(
        "README.md",
        "# Toolchain reports\n\nRead [Linter compatibility](https://baselinejs.vercel.app/docs/compatibility).\n\n`latest.json` identifies immutable paired reports under `runs/<run-id>/<attempt>/`. Failed and partial attempts remain visible. `lastComplete` identifies the latest complete observation, including unexpected results.\n\nThis branch stores text evidence only. It does not deploy the website.\n",
      );
      entries.set("docs/website/vercel.json", json({ git: { deploymentEnabled: false } }));
      await put(entries);
      const tree = await git(["write-tree"]);
      if (base && (await git(["ls-tree", base, directory]))) {
        const previousTree = await git(["rev-parse", `${base}:${directory}`]);
        const candidateTree = await git(["rev-parse", `${tree}:${directory}`]);
        if (previousTree !== candidateTree)
          throw new Error(
            `Run ${run.id}, attempt ${run.attempt} is already published with different content.`,
          );
        const snapshotCommit = (
          await git(["log", "--reverse", "--format=%H", base, "--", `${directory}/report.json`])
        ).split("\n")[0];
        if (!snapshotCommit || !manifest)
          throw new Error("The existing publication has no snapshot commit or manifest.");
        return { manifest, snapshotCommit, published: false };
      }
      const snapshotCommit = await git(
        ["commit-tree", tree, ...(base ? ["-p", base] : [])],
        `Record toolchain run ${run.id}, attempt ${run.attempt}\n`,
      );
      const captures = profiles.flatMap((profile) => {
        const measurement = snapshot.profiles[profile];
        return measurement.kind === "measured" ? [measurement.capturedAt] : [];
      });
      const capturedAt = captures.reduce(
        (latest, captured) => (Date.parse(captured) > Date.parse(latest) ? captured : latest),
        captures[0] ?? run.startedAt,
      );
      const reference: Reference = {
        commit: snapshotCommit,
        runId: run.id,
        runNumber: run.number,
        attempt: run.attempt,
        capturedAt,
      };
      const next: Manifest = {
        schemaVersion: 1,
        latest: !manifest || newer(reference, manifest.latest) ? reference : manifest.latest,
        lastComplete:
          complete(snapshot) && newer(reference, manifest?.lastComplete ?? null)
            ? reference
            : (manifest?.lastComplete ?? null),
      };
      await put(new Map([["latest.json", json(next)]]));
      const pointerTree = await git(["write-tree"]);
      const head = await git(
        ["commit-tree", pointerTree, "-p", snapshotCommit],
        `Update toolchain report index for run ${run.id}\n`,
      );
      try {
        await git(["push", remote, `${head}:refs/heads/${reportBranch}`]);
        return { manifest: next, snapshotCommit, published: true };
      } catch (error) {
        if ((await remoteHead()) === base) throw error;
      }
    }
    throw new Error(
      "The report branch changed during four publication attempts. Retry the publisher job.",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      context: { type: "string" },
      jobs: { type: "string" },
      remote: { type: "string", default: "origin" },
    },
  });
  if (!values.input || !values.context || !values.jobs)
    throw new Error(
      "Usage: node conformance/publish.ts --input DIR --context TRUSTED_CONTEXT_JSON --jobs TRUSTED_JOBS_JSON [--remote origin]",
    );
  const run = parseRunIdentity(await readJson(resolve(values.context)));
  const result = await publish({
    inputDirectory: resolve(values.input),
    repositoryDirectory: process.cwd(),
    run,
    sources: parseSources(await readJson(resolve(values.jobs)), run),
    remote: values.remote,
  });
  process.stdout.write(
    `${result.published ? "Published" : "Already published"} ${result.snapshotCommit}. Latest report is run ${result.manifest.latest.runId}, attempt ${result.manifest.latest.attempt}.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${problem(error)}\n`);
    process.exitCode = 1;
  });
}
