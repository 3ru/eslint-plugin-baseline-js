/**
 * Lint one shard of files with one plugin build in a fresh process and print a JSON
 * measurement line. Started by runner.mjs; the argument is a JSON job file:
 *
 *   { pluginPath, cwd, files, warmupFiles, policy, typed, tsconfig, countNodes }
 *
 * Files are parsed, never executed: ESLint runs with an inline configuration only
 * (`overrideConfigFile: true`, `allowInlineConfig: false`). A short warm-up lints a few
 * files before the clock starts so JIT noise does not dominate small shards.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RULE_ID = "baseline-js/use-baseline";
const COUNTER_ID = "bench/count-nodes";
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const require = createRequire(import.meta.url);

const tSetup = performance.now();
const plugin = (await import(pathToFileURL(job.pluginPath).href)).default;
const { ESLint } = require("eslint");
const tsParser = require("@typescript-eslint/parser");

let nodeCount = 0;
const counterPlugin = {
  rules: {
    "count-nodes": {
      meta: { type: "problem", schema: [] },
      create: () => ({
        "*": () => {
          nodeCount++;
        },
      }),
    },
  },
};

const scriptFiles = ["**/*.{js,mjs,cjs,jsx}"];
const typeScriptFiles = ["**/*.{ts,mts,cts,tsx}"];
const rules = { [RULE_ID]: ["error", job.ruleOptions] };
if (job.countNodes) rules[COUNTER_ID] = "error";
const eslint = new ESLint({
  cwd: job.cwd,
  overrideConfigFile: true,
  allowInlineConfig: false,
  errorOnUnmatchedPattern: false,
  stats: true,
  cache: false,
  overrideConfig: [
    {
      files: scriptFiles,
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
    {
      files: typeScriptFiles,
      languageOptions: {
        parser: tsParser,
        parserOptions: job.typed
          ? {
              project: [job.tsconfig],
              tsconfigRootDir: job.cwd,
              disallowAutomaticSingleRunInference: true,
              ecmaFeatures: { jsx: true },
            }
          : { projectService: false, ecmaFeatures: { jsx: true } },
      },
    },
    {
      files: [...scriptFiles, ...typeScriptFiles],
      plugins: {
        "baseline-js": { meta: plugin.meta, rules: plugin.rules },
        bench: counterPlugin,
      },
      linterOptions: { reportUnusedDisableDirectives: "off" },
      rules,
    },
  ],
});
const setupMs = performance.now() - tSetup;

const tWarm = performance.now();
if (job.warmupFiles?.length) {
  await eslint.lintFiles(job.warmupFiles.map((f) => join(job.cwd, f)));
}
const warmupMs = performance.now() - tWarm;
nodeCount = 0;

let peakHeap = process.memoryUsage().heapUsed;
const sampler = setInterval(() => {
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
}, 20);
sampler.unref();

const cpuBefore = process.cpuUsage();
const tLint = performance.now();
const results = await eslint.lintFiles(job.files.map((f) => join(job.cwd, f)));
const lintMs = performance.now() - tLint;
const cpu = process.cpuUsage(cpuBefore);
clearInterval(sampler);
peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);

let parseMs = 0;
let ruleMs = 0;
let rulesMs = 0;
let reports = 0;
let fatals = 0;
const reportsByFile = {};
for (const result of results) {
  let count = 0;
  for (const pass of result.stats?.times?.passes ?? []) {
    parseMs += pass.parse?.total ?? 0;
    for (const [ruleId, timing] of Object.entries(pass.rules ?? {})) {
      if (ruleId === COUNTER_ID) continue;
      rulesMs += timing.total ?? 0;
      if (ruleId === RULE_ID) ruleMs += timing.total ?? 0;
    }
  }
  for (const message of result.messages) {
    if (message.fatal) fatals++;
    else if (message.ruleId === RULE_ID) {
      reports++;
      count++;
    }
  }
  if (job.perFileReports) reportsByFile[result.filePath.slice(job.cwd.length + 1)] = count;
}

const usage = process.resourceUsage();
process.stdout.write(
  `${JSON.stringify({
    files: results.length,
    setup_ms: setupMs,
    warmup_ms: warmupMs,
    lint_ms: lintMs,
    cpu_ms: (cpu.user + cpu.system) / 1000,
    parse_ms: parseMs,
    rule_ms: ruleMs,
    rules_ms: rulesMs,
    nodes: job.countNodes ? nodeCount : null,
    reports,
    fatals,
    max_rss_kb: usage.maxRSS,
    peak_heap_mb: peakHeap / 1024 / 1024,
    ...(job.perFileReports ? { reportsByFile } : {}),
  })}\n`,
);
