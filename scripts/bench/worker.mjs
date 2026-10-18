/**
 * The measured process: lints one shard with one plugin build and sends one WorkerResult.
 * JavaScript so that Node's type stripper never loads into a measured process.
 */
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createBenchESLint, featureIdFromMessage, pluginExport, RULE_ID } from "./eslint-setup.mjs";

/** @import { ESLint, Rule } from "eslint" */
/** @import { FeatureCounts, FileStats, Job, WorkerResult } from "./types.mts" */

const COUNTER_NAMESPACE = "bench";
const COUNTER_ID = `${COUNTER_NAMESPACE}/count-nodes`;

/**
 * Counts the nodes of the `*` traversal the rule under test sees; its time is not rule time.
 * @param {Map<string, number>} nodesByFile
 * @returns {ESLint.Plugin}
 */
function nodeCounter(nodesByFile) {
  /** @type {Rule.RuleModule} */
  const countNodes = {
    meta: { type: "problem", schema: [] },
    create(context) {
      let nodes = 0;

      return {
        "*"() {
          nodes++;
        },
        "Program:exit"() {
          nodesByFile.set(context.filename, nodes);
        },
      };
    },
  };

  return { rules: { "count-nodes": countNodes } };
}

/**
 * @param {Job} job
 * @param {readonly string[]} files
 * @returns {string[]}
 */
function absolute(job, files) {
  return files.map((file) => resolve(job.cwd, file));
}

/**
 * @param {Job} job
 * @param {string} filePath
 * @returns {string}
 */
function corpusPath(job, filePath) {
  return relative(job.cwd, filePath).split(sep).join("/");
}

/**
 * @param {Job} job
 * @returns {Promise<WorkerResult>}
 */
async function measure(job) {
  const setupStart = performance.now();
  const plugin = pluginExport(await import(pathToFileURL(job.pluginPath).href));
  /** @type {Map<string, number>} */
  const nodesByFile = new Map();

  const eslint = createBenchESLint({
    cwd: job.cwd,
    plugin,
    ruleOptions: job.ruleOptions,
    typed: job.typed,
    tsconfig: job.tsconfig,
    stats: true,
    // Registered either way; only the enabled rule adds a listener.
    extraPlugins: { [COUNTER_NAMESPACE]: nodeCounter(nodesByFile) },
    extraRules: job.countNodes ? { [COUNTER_ID]: "error" } : {},
  });

  const setup_ms = performance.now() - setupStart;

  const warmupStart = performance.now();

  // lintFiles([]) would lint the whole cwd.
  if (job.warmupFiles.length > 0) await eslint.lintFiles(absolute(job, job.warmupFiles));
  const warmup_ms = performance.now() - warmupStart;

  const timedFiles = absolute(job, job.files);
  // process.threadCpuUsage exists from Node 22.19 and 23.9.
  const cpuStart = process.threadCpuUsage === undefined ? null : process.threadCpuUsage();
  const lintStart = performance.now();
  const results = await eslint.lintFiles(timedFiles);
  const lint_ms = performance.now() - lintStart;
  const cpu = cpuStart === null ? null : process.threadCpuUsage(cpuStart);

  if (results.length !== timedFiles.length) {
    throw new Error(`ESLint returned ${results.length} results for ${timedFiles.length} files`);
  }

  let parse_ms = 0;
  let rule_ms = 0;
  let nodes = 0;
  let reports = 0;
  let fatals = 0;
  /** @type {Record<string, FileStats>} */
  const perFile = {};
  /** @type {Record<string, FeatureCounts>} */
  const reportsByFile = {};

  for (const result of results) {
    const path = corpusPath(job, result.filePath);

    if (result.stats === undefined) throw new Error(`ESLint returned no stats for ${path}`);
    const fatal = result.messages.some((message) => message.fatal === true);
    let fileRuleMs = 0;

    for (const pass of result.stats.times.passes) {
      const parse = pass.parse?.total;
      const rule = pass.rules?.[RULE_ID]?.total;

      // A file that fails to parse has no rule times; the report check counts it as fatal.
      if (!fatal && (parse === undefined || rule === undefined)) {
        throw new Error(`ESLint stats for ${path} lack the parse time or ${RULE_ID}`);
      }

      parse_ms += parse ?? 0;
      fileRuleMs += rule ?? 0;
    }

    rule_ms += fileRuleMs;

    let fileNodes = null;

    if (job.countNodes) {
      // The counter never runs on a file that fails to parse.
      fileNodes = nodesByFile.get(result.filePath) ?? (fatal ? 0 : null);

      if (fileNodes === null) throw new Error(`no node count for ${path}`);
      nodes += fileNodes;
    }

    if (job.perFileStats) perFile[path] = { rule_ms: fileRuleMs, nodes: fileNodes };

    /** @type {FeatureCounts} */
    const counts = {};

    for (const message of result.messages) {
      if (message.fatal === true) fatals++;

      if (message.ruleId !== RULE_ID) continue;
      reports++;
      const featureId = featureIdFromMessage(message.message);

      if (featureId === null) throw new Error(`no feature id in "${message.message}" (${path})`);
      counts[featureId] = (counts[featureId] ?? 0) + 1;
    }

    if (job.reportDetails) reportsByFile[path] = counts;
  }

  return {
    files: results.length,
    setup_ms,
    warmup_ms,
    lint_ms,
    thread_cpu_ms: cpu === null ? null : (cpu.user + cpu.system) / 1000,
    parse_ms,
    rule_ms,
    nodes: job.countNodes ? nodes : null,
    reports,
    fatals,
    max_rss_kb: process.resourceUsage().maxRSS,
    perFile: job.perFileStats ? perFile : null,
    reportsByFile: job.reportDetails ? reportsByFile : null,
  };
}

if (process.send === undefined || process.disconnect === undefined) {
  throw new Error("worker.mjs must be forked by runner.mts with an IPC channel");
}

const channel = { send: process.send.bind(process), disconnect: process.disconnect.bind(process) };

/**
 * @param {WorkerResult} result
 * @returns {Promise<void>}
 */
function send(result) {
  return new Promise((done, fail) => {
    channel.send(result, undefined, {}, (error) => (error ? fail(error) : done()));
  });
}

// An error exits with code 1, which the runner reports; nothing is caught here.
process.once("message", async (message) => {
  // SAFETY: runner.mts sends a typed Job over the IPC channel of this fork
  const job = /** @type {Job} */ (message);
  await send(await measure(job));
  // The open channel would keep the process alive.
  channel.disconnect();
});
