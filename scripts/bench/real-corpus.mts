/**
 * Calibration repositories listed in the git-ignored bench/corpus.local.json (see
 * CalibrationManifestSchema): pinned GitHub tarballs or local checkouts, read, never executed.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { CACHE_DIR, compareText, LOCAL_CORPUS_FILE, ROOT, readJsonFile } from "./lib.mts";
import type {
  CalibrationEntry,
  CalibrationManifest,
  MaterializedRepository,
  RemoteCalibrationEntry,
} from "./types.mts";

export const DEFAULT_MAX_FILES = 2000;

/** Written into an extracted repository only after tar succeeded. */
const READY_MARKER = ".bench-ready";

const EXTRACT_EXCLUDES = [
  "--exclude=.*",
  "--exclude=*/.*",
  "--exclude=node_modules",
  "--exclude=*/node_modules/*",
];

/** Build output, vendored code and declarations are not code anyone writes by hand. */
const DEFAULT_EXCLUDE = [
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/*.d.mts",
  "**/*.d.cts",
  "**/__snapshots__/**",
];

const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const FILES_SHA256 = /^[0-9a-f]{64}$/;
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `**`, `*`, `?` and flat `{a,b}`; other syntax throws rather than silently matching nothing. */
function globToRegExp(glob: string): RegExp {
  if (/[[\]!]/.test(glob))
    throw new Error(`unsupported glob syntax in "${glob}": [ ] and ! are not supported`);
  let source = "^";

  for (let i = 0; i < glob.length; i++) {
    const char = glob.charAt(i);

    if (char === "*" && glob.charAt(i + 1) === "*") {
      const slash = glob.charAt(i + 2) === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", i);

      if (end === -1) throw new Error(`unterminated brace in glob "${glob}"`);
      const body = glob.slice(i + 1, end);

      if (/[{*?]/.test(body)) {
        throw new Error(`unsupported glob syntax in "${glob}": braces may only list literal names`);
      }

      source += `(?:${body.split(",").map(escapeRegExp).join("|")})`;
      i = end;
    } else if (char === "}") {
      throw new Error(`unbalanced brace in glob "${glob}"`);
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`${source}$`);
}

/** Case-sensitive and symlink-free everywhere, unlike fs.globSync, so the hash is portable. */
function collectFiles(
  dir: string,
  include: readonly string[],
  exclude: readonly string[],
  maxFiles: number,
): string[] {
  const included = include.map(globToRegExp);
  const excluded = [...DEFAULT_EXCLUDE, ...exclude].map(globToRegExp);
  const found: string[] = [];

  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const path = join(absolute, entry.name);

      if (entry.isDirectory()) {
        visit(path);
        continue;
      }

      const rel = relative(dir, path).replaceAll("\\", "/");

      if (
        entry.isFile() &&
        included.some((r) => r.test(rel)) &&
        !excluded.some((r) => r.test(rel))
      ) {
        found.push(rel);
      }
    }
  };

  visit(dir);

  return found.sort(compareText).slice(0, maxFiles);
}

/** SHA-256 over the path, size and bytes of each selected file, in order. */
function hashFiles(dir: string, files: readonly string[]): string {
  const hash = createHash("sha256");

  for (const rel of files) {
    const data = readFileSync(join(dir, rel));
    hash.update(`${rel}\0${data.length}\0`);
    hash.update(data);
  }

  return hash.digest("hex");
}

const ENTRY_FIELDS = {
  id: z.string().regex(ENTRY_ID),
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).optional(),
  maxFiles: z.int().positive().optional(),
  filesSha256: z.string().regex(FILES_SHA256).optional(),
};

/** Strict: an entry is exactly one kind, and a misspelt key fails rather than change the files. */
export const CalibrationManifestSchema = z
  .object({
    entries: z
      .array(
        z.union(
          [
            z.strictObject({
              ...ENTRY_FIELDS,
              repo: z.string().regex(REPO_NAME),
              ref: z.string().regex(COMMIT_SHA),
            }),
            z.strictObject({ ...ENTRY_FIELDS, local: z.string() }),
          ],
          { error: 'an entry needs either "local" or "repo" with a full 40-hex "ref"' },
        ),
      )
      .min(1),
  })
  .superRefine(({ entries }, ctx) => {
    const ids = new Set<string>();

    for (const { id } of entries) {
      if (ids.has(id)) ctx.addIssue({ code: "custom", message: `duplicate id "${id}"` });
      ids.add(id);
    }
  });

export function loadLocalManifest(file: string = LOCAL_CORPUS_FILE): CalibrationManifest {
  if (!existsSync(file)) {
    throw new Error(
      `${relative(ROOT, file)} not found: calibration needs this local, git-ignored manifest`,
    );
  }

  return readJsonFile(file, CalibrationManifestSchema);
}

/** The entries named by `--only` (all when it is empty); an unknown id throws. */
export function filterEntries(
  manifest: CalibrationManifest,
  only: readonly string[],
): CalibrationEntry[] {
  if (only.length === 0) return manifest.entries;
  const known = new Set(manifest.entries.map((entry) => entry.id));
  const unknown = only.filter((id) => !known.has(id));

  if (unknown.length > 0) throw new Error(`unknown calibration entries: ${unknown.join(", ")}`);

  return manifest.entries.filter((entry) => only.includes(entry.id));
}

/** Behind an HTTP proxy, set NODE_USE_ENV_PROXY=1. */
async function download(url: string, dest: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok || response.body === null) {
    throw new Error(`download failed: ${response.status} ${url}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function extractRemote(entry: RemoteCalibrationEntry, dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = `${dir}.tar.gz`;
  console.error(`[bench] downloading ${entry.repo}@${entry.ref.slice(0, 12)}`);
  await download(`https://codeload.github.com/${entry.repo}/tar.gz/${entry.ref}`, archive);

  const tar = spawnSync(
    "tar",
    ["-xzf", archive, "--strip-components=1", ...EXTRACT_EXCLUDES, "-C", dir],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
  );

  rmSync(archive, { force: true });

  if (tar.error) throw tar.error;

  if (tar.status !== 0) {
    // Without the marker the partial tree is discarded and fetched again next time.
    throw new Error(`${entry.id}: tar exited with ${tar.status}: ${tar.stderr.trim()}`);
  }

  writeFileSync(join(dir, READY_MARKER), `${entry.repo}@${entry.ref}\n`);
}

export async function ensureRealCorpusDir(
  entry: CalibrationEntry,
  {
    cacheDir = CACHE_DIR,
    maxFiles = DEFAULT_MAX_FILES,
  }: { cacheDir?: string; maxFiles?: number } = {},
): Promise<MaterializedRepository> {
  let dir: string;

  if ("local" in entry) {
    dir = resolve(ROOT, entry.local);
  } else {
    dir = join(cacheDir, "real", `${entry.id}-${entry.ref.slice(0, 12)}`);

    if (!existsSync(join(dir, READY_MARKER))) await extractRemote(entry, dir);
  }

  const files = collectFiles(dir, entry.include, entry.exclude ?? [], entry.maxFiles ?? maxFiles);

  if (files.length === 0) {
    throw new Error(`${entry.id}: no files matched ${JSON.stringify(entry.include)} in ${dir}`);
  }

  const hash = hashFiles(dir, files);

  if (entry.filesSha256 !== undefined && entry.filesSha256 !== hash) {
    throw new Error(
      `${entry.id}: the selected files differ from filesSha256 (expected ${entry.filesSha256.slice(0, 12)}, got ${hash.slice(0, 12)}); update the calibration manifest if this is intended`,
    );
  }

  return { dir, files, hash };
}
