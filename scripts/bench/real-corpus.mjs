/**
 * Real-repository corpus for local calibration only (`pnpm bench:calibrate`).
 *
 * Entries come from the git-ignored `bench/corpus.local.json`:
 *
 *   { "entries": [ { "id": "example", "repo": "owner/name", "ref": "<40-hex commit>",
 *                    "include": ["src/**\/*.ts"], "exclude": [], "maxFiles": 2000,
 *                    "filesSha256": "<optional hash of the linted files>" } ] }
 *
 * Archives are fetched by commit SHA from codeload.github.com without hidden
 * directories or node_modules, and the linted files are hashed. Nothing is executed.
 * Set NODE_USE_ENV_PROXY=1 behind an HTTP proxy.
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
import { join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CACHE_DIR, LOCAL_CORPUS_FILE, ROOT, readJson } from "./lib.mjs";

export const DEFAULT_MAX_FILES = 2000;
const EXTRACT_EXCLUDES = [
  "--exclude=.*",
  "--exclude=*/.*",
  "--exclude=node_modules",
  "--exclude=*/node_modules/*",
];
export const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/*.d.mts",
  "**/*.d.cts",
  "**/__snapshots__/**",
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a glob (`**`, `*`, `?`, `{a,b}`) into an anchored RegExp over `/`-separated paths. */
export function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) throw new Error(`unterminated brace in glob: ${glob}`);
      re += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map(escapeRegExp)
        .join("|")})`;
      i = end;
    } else re += escapeRegExp(c);
  }
  return new RegExp(`${re}$`);
}

/** Deterministically list files under `dir` matching the globs (sorted, capped). */
export function collectFiles(dir, { include, exclude = [], maxFiles = DEFAULT_MAX_FILES }) {
  const inc = include.map(globToRegExp);
  const exc = [...DEFAULT_EXCLUDE, ...exclude].map(globToRegExp);
  const out = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) continue;
      const abs2 = join(abs, entry.name);
      const rel = relative(dir, abs2).split(sep).join("/");
      if (entry.isDirectory()) {
        walk(abs2);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!inc.some((r) => r.test(rel)) || exc.some((r) => r.test(rel))) continue;
      out.push(rel);
    }
  };
  walk(dir);
  out.sort();
  return out.slice(0, maxFiles);
}

export function selectFiles(entry, dir, maxFiles = DEFAULT_MAX_FILES) {
  return collectFiles(dir, {
    include: entry.include,
    exclude: entry.exclude ?? [],
    maxFiles: entry.maxFiles ?? maxFiles,
  });
}

/** SHA-256 over the selected files: sorted relative paths with sizes and bytes. */
export function hashFiles(dir, files) {
  const hash = createHash("sha256");
  for (const rel of [...files].sort()) {
    const data = readFileSync(join(dir, rel));
    hash.update(`${rel}\0${data.length}\0`);
    hash.update(data);
  }
  return hash.digest("hex");
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

export function loadLocalManifest(file = LOCAL_CORPUS_FILE) {
  if (!existsSync(file)) {
    throw new Error(
      `${relative(ROOT, file)} not found. Calibration needs a local, git-ignored manifest; see docs/BENCHMARKS.md.`,
    );
  }
  const manifest = readJson(file);
  if (!Array.isArray(manifest.entries) || !manifest.entries.length) {
    throw new Error(`${relative(ROOT, file)}: "entries" must be a non-empty array`);
  }
  return manifest;
}

/** Materialise one real-repository entry and return `{ dir, files, hash }`. */
export async function ensureRealCorpusDir(
  entry,
  { cacheDir = CACHE_DIR, maxFiles = DEFAULT_MAX_FILES } = {},
) {
  if (entry.local) {
    const dir = resolve(ROOT, entry.local);
    const files = selectFiles(entry, dir, maxFiles);
    return { dir, files, hash: hashFiles(dir, files) };
  }
  if (!entry.repo || !/^[0-9a-f]{40}$/.test(entry.ref ?? "")) {
    throw new Error(`${entry.id}: needs "repo" and a full 40-hex "ref"`);
  }
  mkdirSync(cacheDir, { recursive: true });
  const dir = join(cacheDir, "real", `${entry.id}-${entry.ref.slice(0, 12)}`);
  const marker = join(dir, ".bench-ready");
  if (!existsSync(marker)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const archive = `${dir}.tar.gz`;
    console.error(`[bench] downloading ${entry.repo}@${entry.ref.slice(0, 12)}`);
    await download(`https://codeload.github.com/${entry.repo}/tar.gz/${entry.ref}`, archive);
    const tar = spawnSync(
      "tar",
      ["-xzf", archive, "--strip-components=1", ...EXTRACT_EXCLUDES, "-C", dir],
      {
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf8",
      },
    );
    rmSync(archive, { force: true });
    if (tar.status !== 0) {
      const tail = (tar.stderr ?? "").trim().split("\n").slice(-2).join(" | ");
      console.error(
        `[bench] ${entry.id}: tar exited with ${tar.status} (${tail}); only the selected files matter`,
      );
    }
    writeFileSync(marker, `${new Date().toISOString()}\n`);
  }
  const files = selectFiles(entry, dir, maxFiles);
  if (!files.length)
    throw new Error(`${entry.id}: no files matched ${JSON.stringify(entry.include)} in ${dir}`);
  const hash = hashFiles(dir, files);
  if (entry.filesSha256 && entry.filesSha256 !== hash) {
    console.error(
      `[bench] ${entry.id}: linted files differ from the manifest hash (expected ${entry.filesSha256.slice(0, 12)}, got ${hash.slice(0, 12)}); update filesSha256 if this is intended`,
    );
  }
  return { dir, files, hash };
}
