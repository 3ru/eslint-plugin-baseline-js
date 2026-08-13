#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatBaselineYear, readGeneratedFeatures } from "./parse-generated-features.mjs";

// Lightweight parser for descriptors.*.ts arrays
function parseDescriptorsArray(tsPath) {
  const src = readFileSync(tsPath, "utf8");
  const arr = [];
  const re = /(?:"featureId"|featureId):\s*"([^"]+)"[\s\S]*?(?:"kind"|kind):\s*"([^"]+)"/g;
  for (const m of src.matchAll(re)) arr.push({ featureId: m[1], kind: m[2] });
  return arr;
}

function readJson(jsonPath) {
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}
function parseMappingSyntax(tsPath) {
  const src = readFileSync(tsPath, "utf8");
  // Very simple extractor: find top-level entries like "feature-id": { ... delegates: [ ... ] }
  const out = {};
  const entryRegex =
    /(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{[\s\S]*?delegates\s*:\s*\[([\s\S]*?)\][\s\S]*?\}/g;
  for (const m of src.matchAll(entryRegex)) {
    const id = m[1] || m[2];
    const block = m[3];
    const dels = [];
    const delRegex = /\{[\s\S]*?plugin\s*:\s*"([^"]+)"[\s\S]*?rule\s*:\s*"([^"]+)"[\s\S]*?\}/g;
    for (const d of block.matchAll(delRegex)) {
      dels.push({ plugin: d[1], rule: d[2] });
    }
    out[id] = { delegates: dels };
  }
  return out;
}

function mapBaseline(b) {
  if (b === "high") return "widely";
  if (b === "low") return "newly";
  if (b === false) return "limited";
  return "unknown";
}

const root = resolve(process.cwd());
const wfPkgPath = resolve(root, "node_modules/web-features/package.json");

// Inputs (new paths)
const jsFeaturesPath = resolve(root, "src/baseline/data/features.javascript.ts");
const apiFeaturesPath = resolve(root, "src/baseline/data/features.api.ts");
const jsbiFeaturesPath = resolve(root, "src/baseline/data/features.jsbi.ts");
const mappingPath = resolve(root, "src/baseline/mapping/syntax.ts");
const descriptorsApiPath = resolve(root, "src/baseline/data/descriptors.api.ts");
const descriptorsJsbiPath = resolve(root, "src/baseline/data/descriptors.jsbi.ts");

const jsFeatures = readGeneratedFeatures(jsFeaturesPath);
const apiFeatures = readGeneratedFeatures(apiFeaturesPath);
const jsbiFeatures = readGeneratedFeatures(jsbiFeaturesPath);
const mapping = parseMappingSyntax(mappingPath);
const descApi = parseDescriptorsArray(descriptorsApiPath);
const descJsbi = parseDescriptorsArray(descriptorsJsbiPath);
let wfVersion = "unknown";
try {
  wfVersion = readJson(wfPkgPath).version || "unknown";
} catch {}

// Section 1: JS language (syntax)
const rowsJs = [];
const jsIds = Object.keys(jsFeatures);
const seenJs = new Set();
const mappedSyntaxIds = Object.keys(mapping);
let mappedJs = 0;
for (const id of jsIds.sort()) {
  if (seenJs.has(id)) continue;
  seenJs.add(id);
  const f = jsFeatures[id];
  const status = f.status || {};
  const bucket = mapBaseline(status.baseline);
  const year = formatBaselineYear(status);
  const mapped = mappedSyntaxIds.includes(id);
  let mechanism = "-";
  let delegates = "";
  if (mapped) {
    const dels = mapping[id].delegates || [];
    delegates = dels.map((d) => `\`${d.plugin}:${d.rule}\``).join(", ");
    const hasSelf = dels.some((d) => d.plugin === "self");
    mechanism = hasSelf ? "self" : "delegate"; // delegate = es-x/core
    mappedJs++;
  }
  rowsJs.push({ id, name: f.name || id, bucket, year, mapped, mechanism, delegates });
}
function pct1(mapped, total) {
  return total ? ((mapped / total) * 100).toFixed(1) : "0.0";
}
const covJs = pct1(mappedJs, jsIds.length);

// Load coverage exclusion config (memo / exclusions)
let covConfig = { api: { byId: {} }, jsbi: { byId: {} } };
try {
  const mod = await import(pathToFileURL(resolve(root, "scripts/coverage/config.mjs")).href);
  covConfig = mod.default || mod.covConfig || covConfig;
} catch {
  // no config, proceed with defaults
}

// Section 2: Web APIs (api.*) – classify patterns: safe (AST), typed (instanceMember), heuristic (future)
const rowsApi = [];
const apiIds = Object.keys(apiFeatures);
const seenApi = new Set();
const apiPatternMap = new Map(); // id -> {safe:number, typed:number, heuristic:number}
for (const d of descApi) {
  const rec = apiPatternMap.get(d.featureId) || { safe: 0, typed: 0, heuristic: 0 };
  if (d.kind === "instanceMember") rec.typed++;
  else rec.safe++;
  apiPatternMap.set(d.featureId, rec);
}
let mappedApi = 0;
let excludedApi = 0;
let includedApiTotal = 0;
for (const id of apiIds.sort()) {
  if (seenApi.has(id)) continue;
  seenApi.add(id);
  const f = apiFeatures[id];
  const status = f.status || {};
  const bucket = mapBaseline(status.baseline);
  const year = formatBaselineYear(status);
  const pat = apiPatternMap.get(id) || { safe: 0, typed: 0, heuristic: 0 };
  const patterns = [];
  if (pat.safe > 0) patterns.push("safe");
  if (pat.typed > 0) patterns.push("typed");
  if (pat.heuristic > 0) patterns.push("heuristic");
  const memo = covConfig.api?.byId?.[id]?.memo || "";
  const exclude = !!covConfig.api?.byId?.[id]?.exclude;
  const mapped = patterns.length > 0;
  if (exclude) {
    excludedApi++;
  } else {
    includedApiTotal++;
    if (mapped) mappedApi++;
  }
  rowsApi.push({
    id,
    name: f.name || id,
    bucket,
    year,
    mapped,
    patterns,
    count: pat.safe + pat.typed + pat.heuristic,
    memo,
    exclude,
  });
}
const covApi = pct1(mappedApi, includedApiTotal);

// Section 3: JS builtins (javascript.*) – classify patterns similar to APIs (with exclusions)
const rowsJsbi = [];
const jsbiIds = Object.keys(jsbiFeatures);
const seenJsbi = new Set();
const jsbiPatternMap = new Map();
for (const d of descJsbi) {
  const rec = jsbiPatternMap.get(d.featureId) || { safe: 0, typed: 0, heuristic: 0 };
  if (d.kind === "instanceMember") rec.typed++;
  else rec.safe++;
  jsbiPatternMap.set(d.featureId, rec);
}
let mappedJsbi = 0;
let excludedJsbi = 0;
let includedJsbiTotal = 0;
for (const id of jsbiIds.sort()) {
  if (seenJsbi.has(id)) continue;
  seenJsbi.add(id);
  const f = jsbiFeatures[id];
  const status = f.status || {};
  const bucket = mapBaseline(status.baseline);
  const year = formatBaselineYear(status);
  const pat = jsbiPatternMap.get(id) || { safe: 0, typed: 0, heuristic: 0 };
  const patterns = [];
  if (pat.safe > 0) patterns.push("safe");
  if (pat.typed > 0) patterns.push("typed");
  if (pat.heuristic > 0) patterns.push("heuristic");
  const entryCfg = covConfig.jsbi?.byId?.[id] || {};
  const memo = entryCfg.memo || "";
  const exclude = !!entryCfg.exclude;
  const mappedVia = entryCfg.mappedVia || null; // 'delegate' | 'self' | null
  const hasSyntaxDelegate = mappedSyntaxIds.includes(id);
  const mapped = patterns.length > 0 || !!mappedVia || hasSyntaxDelegate;
  if (exclude) {
    excludedJsbi++;
  } else {
    includedJsbiTotal++;
    if (mapped) mappedJsbi++;
  }
  rowsJsbi.push({
    id,
    name: f.name || id,
    bucket,
    year,
    mapped,
    patterns,
    count: pat.safe + pat.typed + pat.heuristic,
    memo,
    exclude,
  });
}
const covJsbi = pct1(mappedJsbi, includedJsbiTotal);

function mdEscape(s) {
  // Escape backslashes first, then pipes used as table delimiters
  return String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
// Produce a fenced inline code span that safely contains backticks.
// If the content includes backticks, choose a fence length greater than any
// backtick run inside and surround content with a leading/trailing space.
function mdCode(s) {
  const t = String(s);
  const matches = t.match(/`+/g);
  const maxTicks = matches ? Math.max(...matches.map((m) => m.length)) : 0;
  const fence = "`".repeat(Math.max(1, maxTicks + 1));
  // Surround with spaces per Markdown spec when using longer fences
  return `${fence} ${t} ${fence}`;
}
function mdListCode(arr) {
  if (!arr || arr.length === 0) return "-";
  return arr.map((x) => mdCode(x)).join(", ");
}

let md = "";
md += [
  "<!--",
  "  @fileoverview Coverage report generated by scripts/coverage/generate-coverage.mjs",
  "  THIS FILE IS AUTOGENERATED. DO NOT EDIT DIRECTLY.",
  "-->",
  "",
].join("\n");
md += "# Baseline Coverage\n\n";
md += `- web-features: [\`v${wfVersion}\`](https://github.com/web-platform-dx/web-features/releases/tag/v${wfVersion})\n`;
md += "\n## JavaScript Language (syntax)\n\n";
md += `- total: \`${jsIds.length}\`\n`;
md += `- mapped: \`${mappedJs}\`\n`;
md += `- coverage: \`${covJs}%\`\n\n`;
md += "| Feature ID | Name | Baseline | Year | Mapped | Mechanism | Delegates |\n";
md += "| --- | --- | --- | --- | --- | --- | --- |\n";
for (const r of rowsJs) {
  md += `| ${mdEscape(r.id)} | ${mdCode(r.name)} | ${r.bucket} | ${r.year || "-"} | ${r.mapped ? "✅" : "❌"} | ${mdCode(r.mechanism || "-")} | ${r.delegates || "-"} |\n`;
}

md += "\n## Web APIs (api.*)\n\n";
md += `- total: \`${apiIds.length}\`\n`;
md += `- excluded (out-of-scope): \`${excludedApi}\`\n`;
md += `- included (in-scope): \`${includedApiTotal}\`\n`;
md += `- mapped: \`${mappedApi}\`\n`;
md += `- coverage: \`${covApi}%\`\n\n`;
md += "| Feature ID | Name | Baseline | Year | Mapped | Patterns | Descriptors | Memo |\n";
md += "| --- | --- | --- | --- | --- | --- | --- | --- |\n";
for (const r of rowsApi) {
  const pats = mdListCode(r.patterns);
  md += `| ${mdEscape(r.id)} | ${mdCode(r.name)} | ${r.bucket} | ${r.year || "-"} | ${r.mapped ? "✅" : "❌"} | ${pats} | ${r.mapped ? r.count : "-"} | ${r.memo ? r.memo : "-"} |\n`;
}

md += "\n## JavaScript Builtins (javascript.*)\n\n";
md += `- total: \`${jsbiIds.length}\`\n`;
md += `- excluded (out-of-scope): \`${excludedJsbi}\`\n`;
md += `- included (in-scope): \`${includedJsbiTotal}\`\n`;
md += `- mapped: \`${mappedJsbi}\`\n`;
md += `- coverage: \`${covJsbi}%\`\n\n`;
md += "| Feature ID | Name | Baseline | Year | Mapped | Patterns | Descriptors | Memo |\n";
md += "| --- | --- | --- | --- | --- | --- | --- | --- |\n";
for (const r of rowsJsbi) {
  const pats = mdListCode(r.patterns);
  md += `| ${mdEscape(r.id)} | ${mdCode(r.name)} | ${r.bucket} | ${r.year || "-"} | ${r.mapped ? "✅" : "❌"} | ${pats} | ${r.mapped ? r.count : "-"} | ${r.memo ? r.memo : "-"} |\n`;
}

// Aggregate stats
const stats = {
  javascript: { total: jsIds.length, mapped: mappedJs, coverage: `${covJs}%` },
  webApis: {
    total: apiIds.length,
    excluded: excludedApi,
    included: includedApiTotal,
    mapped: mappedApi,
    coverage: `${covApi}%`,
  },
  jsBuiltins: {
    total: jsbiIds.length,
    excluded: excludedJsbi,
    included: includedJsbiTotal,
    mapped: mappedJsbi,
    coverage: `${covJsbi}%`,
  },
};

const outDir = resolve(root, "docs");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "coverage.md");
writeFileSync(outPath, md, "utf8");

// Also emit a Fumadocs page with frontmatter + callout for the website
try {
  const mdxDir = resolve(root, "docs/website/content/docs/meta");
  mkdirSync(mdxDir, { recursive: true });
  const mdxPath = resolve(mdxDir, "coverage.mdx");
  // Remove HTML comments (all occurrences) and top-level H1 from markdown for MDX embedding
  // Use a global regex to ensure multiple comment blocks are removed
  let mdxBody = md.replace(/<!--[\s\S]*?-->/g, "");
  mdxBody = mdxBody.replace(/^# [^\n]+\n+/, "");
  const mdxSummary =
    `### Summary\n\n` +
    `| Category | Total | Excluded | Included | Mapped | Coverage |\n` +
    `| --- | ---:| ---:| ---:| ---:| ---:|\n` +
    `| JavaScript (syntax) | ${stats.javascript.total} | — | — | ${stats.javascript.mapped} | ${stats.javascript.coverage} |\n` +
    `| Web APIs | ${stats.webApis.total} | ${stats.webApis.excluded} | ${stats.webApis.included} | ${stats.webApis.mapped} | ${stats.webApis.coverage} |\n` +
    `| JS Builtins | ${stats.jsBuiltins.total} | ${stats.jsBuiltins.excluded} | ${stats.jsBuiltins.included} | ${stats.jsBuiltins.mapped} | ${stats.jsBuiltins.coverage} |\n\n`;

  const mdx =
    `---\n` +
    `title: Coverage\n` +
    `description: Auto-generated Baseline coverage report.\n` +
    `---\n\n` +
    `<Callout title="This page is auto-generated" type="info">\n` +
    `Coverage report generated by <code>scripts/coverage/generate-coverage.mjs</code>. Do NOT edit this file directly.\n` +
    `</Callout>\n\n` +
    mdxSummary +
    mdxBody;
  writeFileSync(mdxPath, mdx, "utf8");
} catch (e) {
  console.warn("Failed to write website coverage.mdx:", e?.message || e);
}
// Console summary stats for quick visibility
console.log("Baseline coverage stats:");
console.log(
  `  - JavaScript (syntax): total=${stats.javascript.total}, mapped=${stats.javascript.mapped}, coverage=${stats.javascript.coverage}`,
);
console.log(
  `  - Web APIs (api.*): total=${stats.webApis.total}, excluded=${stats.webApis.excluded}, included=${stats.webApis.included}, mapped=${stats.webApis.mapped}, coverage=${stats.webApis.coverage}`,
);
console.log(
  `  - JS Builtins (javascript.*): total=${stats.jsBuiltins.total}, mapped=${stats.jsBuiltins.mapped}, coverage=${stats.jsBuiltins.coverage}`,
);
console.log(`Wrote coverage report to ${outPath}`);
console.log(`Wrote website coverage page to docs/website/content/docs/meta/coverage.mdx`);
