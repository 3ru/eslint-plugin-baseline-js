import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  applyEdit,
  assess,
  fixRunProblem,
  renderReport,
  suggestionPayloadProblem,
} from "./assess.mjs";
import { cases, requiresTypes } from "./cases.mjs";
import { configFiles, hostNames, hosts } from "./hosts.mjs";
import { probePluginName, probeRuleId, productPluginName, productRuleId } from "./protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = dirname(here);
const { values } = parseArgs({ options: { out: { type: "string" } } });
const output = resolve(values.out ?? join(here, "results"));
const profile = process.env.CONFORMANCE_PROFILE ?? "pinned";
if (!["pinned", "latest"].includes(profile)) throw new Error(`Unknown profile: ${profile}`);
// Generated output starts empty, so files from an earlier run never pass for this run's.
for (const directory of ["raw", "work"]) {
  rmSync(join(output, directory), { recursive: true, force: true });
}
mkdirSync(join(output, "raw"), { recursive: true });
const hash = (content) => createHash("sha256").update(content).digest("hex");
const read = (path) => readFileSync(path, "utf8");
const report = {
  capturedAt: new Date().toISOString(),
  profile,
  policy: { available: 2019, includeWebApis: true, includeJsBuiltins: true },
  results: [],
  tools: {},
};

function execute(command, args, cwd, artifact) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const run = {
    command: [command, ...args],
    cwd,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  if (artifact) {
    run.raw = {
      stdout: `raw/${artifact}.stdout`,
      stderr: `raw/${artifact}.stderr`,
    };
    writeFileSync(join(output, run.raw.stdout), run.stdout);
    writeFileSync(join(output, run.raw.stderr), run.stderr);
  }
  return run;
}

function metadataCommand(command, args) {
  const result = execute(command, args, repository);
  if (result.exitCode !== 0 || result.error) {
    throw new Error(result.error || result.stderr || `Failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout.trimEnd();
}

// Rule configuration for one case. The suggest phase turns the probe's fix off, so that only its
// suggestion can change the file.
function configFor(testCase, paths, suggestionsOnly) {
  const needsTypes = requiresTypes(testCase);
  const probeOptions = { check: testCase.check };
  if (testCase.member) probeOptions.member = testCase.member;
  if (suggestionsOnly) probeOptions.suggestionsOnly = true;
  const rules = { [probeRuleId]: ["warn", probeOptions] };
  if (testCase.suite === "baseline") {
    const preset = needsTypes ? "type-aware" : "auto";
    rules[productRuleId] = [
      "error",
      {
        available: report.policy.available,
        includeWebApis: { preset },
        includeJsBuiltins: { preset },
      },
    ];
  }
  // JavaScript fixtures use each host's own parser and scope analysis. Only TypeScript fixtures
  // need typescript-eslint, and only typed cases point it at a project.
  const typescript = testCase.extension === "ts";
  const languageOptions = { ecmaVersion: "latest", sourceType: "module" };
  if (needsTypes) {
    languageOptions.parserOptions = {
      project: join(output, "work", "tsconfig.json"),
      tsconfigRootDir: join(output, "work"),
    };
  }
  const imports = [
    `import probe from ${JSON.stringify(pathToFileURL(join(here, "probe.mjs")).href)};`,
  ];
  if (typescript) {
    imports.push(`import parser from ${JSON.stringify(pathToFileURL(paths.parser).href)};`);
  }
  if (testCase.suite === "baseline") {
    imports.push(`import baseline from ${JSON.stringify(pathToFileURL(paths.product).href)};`);
  }
  const config = { files: ["**/*.{js,ts}"], languageOptions, rules };
  const plugins = [`'${probePluginName}': probe`];
  if (testCase.suite === "baseline") plugins.push(`'${productPluginName}': baseline`);
  const statements = [
    ...imports,
    `const config = ${JSON.stringify(config)};`,
    ...(typescript ? ["config.languageOptions.parser = parser;"] : []),
    `config.plugins = { ${plugins.join(", ")} };`,
    "export default [config];",
  ];
  const eslint = `${statements.join("\n")}\n`;
  // Plain specifiers, as the root README documents them: Oxlint derives the plugin names itself.
  const jsPlugins = [join(here, "probe.mjs")];
  if (testCase.suite === "baseline") jsPlugins.push(paths.product);
  const oxlint = JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins,
    rules,
  });
  return { eslint, oxlint };
}

function writeConfigs(testCase, paths, directory, format) {
  const phases = testCase.expectedSuggestions ? ["inspect", "suggest"] : ["inspect"];
  for (const phase of phases) {
    const texts = configFor(testCase, paths, phase === "suggest");
    writeFileSync(join(directory, configFiles[format][phase]), texts[format]);
  }
}

function lint(tool, paths, testCase, directory, phase = "inspect") {
  const file = `input.${testCase.extension}`;
  const flags = { inspect: [], fix: ["--fix"], suggest: ["--fix", "--fix-suggestions"] }[phase];
  const common = ["--no-ignore", "-f", "json", ...flags, file];
  const config = configFiles[hosts[tool].configFormat][phase === "suggest" ? "suggest" : "inspect"];
  const artifact = `${tool}-${testCase.id}-${phase}`;
  let command = process.execPath;
  let args = [tool === "eslint" ? paths.eslint : paths.oxlint, "-c", config, ...common];
  if (tool === "bun") {
    command = paths.bun;
    const typeAware = requiresTypes(testCase) ? ["--type-aware"] : [];
    args = ["lint", "-c", config, ...typeAware, ...common];
  }
  const run = execute(command, args, directory, artifact);
  run.config = config;
  run.configSha256 = hash(readFileSync(join(directory, config)));
  if (phase !== "inspect") {
    // Keep the file the host wrote; not every JSON format includes it.
    run.raw.result = `raw/${artifact}.result.${testCase.extension}`;
    writeFileSync(join(output, run.raw.result), readFileSync(join(directory, file)));
  }
  return run;
}

const completed = (run) => !run.error && !run.signal && run.exitCode === 0;

try {
  const dependencies = profile === "latest" ? join(here, "results", "latest-tools") : here;
  const require = createRequire(join(dependencies, "package.json"));
  const bunRequire = createRequire(require.resolve("bun/package.json"));
  const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
  // The bun package ships separate musl builds; only glibc Linux is resolved below.
  const glibc =
    process.platform !== "linux" ||
    process.report.getReport().header.glibcVersionRuntime !== undefined;
  if (
    !["darwin", "linux"].includes(process.platform) ||
    !["x64", "arm64"].includes(process.arch) ||
    !glibc
  ) {
    throw new Error("This harness supports macOS and glibc Linux on x64/arm64");
  }
  const paths = {
    parser: require.resolve("@typescript-eslint/parser"),
    eslint: join(dirname(require.resolve("eslint/package.json")), "bin", "eslint.js"),
    oxlint: join(dirname(require.resolve("oxlint/package.json")), "bin", "oxlint"),
    bun: join(
      dirname(bunRequire.resolve(`@oven/bun-${process.platform}-${architecture}/package.json`)),
      "bin",
      "bun",
    ),
    product: join(repository, "dist", "index.mjs"),
  };
  // On pull requests the checkout is GitHub's test merge; keep the PR's own commits next to it.
  const pullRequest = process.env.CONFORMANCE_PR_HEAD
    ? { head: process.env.CONFORMANCE_PR_HEAD, base: process.env.CONFORMANCE_PR_BASE }
    : undefined;
  report.source = {
    commit: metadataCommand("git", ["rev-parse", "HEAD"]),
    dirty: metadataCommand("git", ["status", "--porcelain"]).split("\n").filter(Boolean),
    pullRequest,
  };
  report.environment = {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  };
  // The build under test, its manifest and lockfile, and every file of this harness.
  const harnessFiles = readdirSync(here, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `conformance/${entry.name}`);
  report.inputs = Object.fromEntries(
    ["package.json", "pnpm-lock.yaml", "dist/index.mjs", ...harnessFiles].map((path) => [
      path,
      hash(readFileSync(join(repository, path))),
    ]),
  );
  const productRequire = createRequire(paths.product);
  report.product = {
    source: "checkout dist build",
    version: JSON.parse(read(join(repository, "package.json"))).version,
    // dist/index.mjs resolves these from the root install, whichever host loads it.
    imports: Object.fromEntries(
      ["eslint", "eslint-plugin-es-x"].map((name) => [
        name,
        JSON.parse(read(productRequire.resolve(`${name}/package.json`))).version,
      ]),
    ),
  };
  report.dependencies = Object.fromEntries(
    ["eslint", "@typescript-eslint/parser", "typescript", "oxlint", "bun"].map((name) => [
      name,
      JSON.parse(read(require.resolve(`${name}/package.json`))).version,
    ]),
  );
  report.dependencyManifestSha256 = hash(readFileSync(join(dependencies, "package.json")));
  report.dependencyLockSha256 = hash(readFileSync(join(dependencies, "pnpm-lock.yaml")));
  report.tools = {
    eslint: { version: metadataCommand(process.execPath, [paths.eslint, "--version"]) },
    oxlint: {
      // oxlint prints "Version: x.y.z".
      version: metadataCommand(process.execPath, [paths.oxlint, "--version"]).replace(
        /^Version: /,
        "",
      ),
    },
    bun: {
      version: metadataCommand(paths.bun, ["--revision"]),
      binarySha256: hash(readFileSync(paths.bun)),
    },
  };
  const work = join(output, "work");
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(work, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { target: "ESNext", lib: ["ESNext", "DOM"], strict: true, noEmit: true, types: [] }, include: ["**/*.ts"] }, null, 2)}\n`,
  );
  // Every TypeScript fixture exists before the first typed run, so all hosts see one program.
  for (const testCase of cases) {
    const directory = join(work, testCase.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `input.${testCase.extension}`), testCase.code);
  }
  for (const tool of hostNames) {
    const host = hosts[tool];
    for (const testCase of cases) {
      const directory = join(work, testCase.id);
      const input = join(directory, `input.${testCase.extension}`);
      writeFileSync(input, testCase.code);
      writeConfigs(testCase, paths, directory, host.configFormat);
      const run = lint(tool, paths, testCase, directory);
      const fixes = {};
      const extraRuns = [];
      if (testCase.expectedFix && completed(run)) {
        const fixed = lint(tool, paths, testCase, directory, "fix");
        extraRuns.push(fixed);
        const expected = applyEdit(testCase.code, testCase.expectedFix);
        fixes.fixProblem = fixRunProblem(tool, fixed, read(input), expected);
        fixes.fixMatched = fixes.fixProblem === undefined;
        writeFileSync(input, testCase.code);
      }
      if (testCase.expectedSuggestions && completed(run)) {
        const methods = [];
        if (host.suggestionPayload) {
          const problem = suggestionPayloadProblem(tool, run, testCase);
          methods.push({ method: "diagnostic suggestion payload", problem, matched: !problem });
        }
        if (host.appliesSuggestions) {
          const suggested = lint(tool, paths, testCase, directory, "suggest");
          extraRuns.push(suggested);
          // Hosts apply the first suggestion of a diagnostic.
          const expected = applyEdit(testCase.code, testCase.expectedSuggestions[0].fix);
          const problem = fixRunProblem(tool, suggested, read(input), expected);
          methods.push({ method: "--fix-suggestions application", problem, matched: !problem });
          writeFileSync(input, testCase.code);
        }
        fixes.suggestions = methods;
        fixes.suggestionsMatched = methods.length > 0 && methods.every((entry) => entry.matched);
      }
      const result = assess(testCase, tool, run, fixes, host);
      const recordRun = ({ stdout, stderr, ...metadata }) => metadata;
      report.results.push({
        ...result,
        tool,
        expected: testCase.expected,
        fixtureSha256: hash(testCase.code),
        run: recordRun(run),
        extraRuns: extraRuns.map(recordRun),
      });
      console.log(
        `${tool}: ${testCase.id}: ${result.status}${result.expectationMatched ? "" : " (unexpected)"}`,
      );
    }
  }
} catch (error) {
  report.error = error.stack ?? String(error);
  console.error(report.error);
} finally {
  report.expectationMatched =
    !report.error &&
    report.results.length === cases.length * hostNames.length &&
    report.results.every((result) => result.expectationMatched);
  writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(output, "report.md"), renderReport(report));
  if (!report.expectationMatched) process.exitCode = 1;
}
