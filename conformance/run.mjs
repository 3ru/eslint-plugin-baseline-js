import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { assess, fixRunMatches, parseDiagnostics, renderReport } from "./assess.mjs";
import { cases, requiresTypes } from "./cases.mjs";
import { hostNames, hosts } from "./hosts.mjs";
import { probePluginName, probeRuleId, productPluginName, productRuleId } from "./protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = dirname(here);
const { values } = parseArgs({ options: { out: { type: "string" } } });
const output = resolve(values.out ?? join(here, "results"));
const profile = process.env.CONFORMANCE_PROFILE ?? "pinned";
if (!["pinned", "latest"].includes(profile)) throw new Error(`Unknown profile: ${profile}`);
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

function configFor(testCase, paths, directory, suggestionsOnly = false) {
  const needsTypes = requiresTypes(testCase);
  const probeOptions = { check: testCase.check, ...(suggestionsOnly ? { suggestionsOnly } : {}) };
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
  const globals = Object.fromEntries(
    ["window", "self", "globalThis", "navigator", "fetchLater"].map((name) => [name, "readonly"]),
  );
  const parserOptions = needsTypes
    ? { project: join(output, "work", "tsconfig.json"), tsconfigRootDir: join(output, "work") }
    : {};
  const imports = [
    `import probe from ${JSON.stringify(pathToFileURL(join(here, "probe.mjs")).href)};`,
    `import parser from ${JSON.stringify(pathToFileURL(paths.parser).href)};`,
  ];
  if (testCase.suite === "baseline") {
    imports.push(`import baseline from ${JSON.stringify(pathToFileURL(paths.product).href)};`);
  }
  const config = {
    files: ["**/*.{js,ts}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals, parserOptions },
    rules,
  };
  const plugins = [`'${probePluginName}': probe`];
  if (testCase.suite === "baseline") plugins.push(`'${productPluginName}': baseline`);
  const eslint = `${imports.join("\n")}\nconst config = ${JSON.stringify(config)};\nconfig.languageOptions.parser = parser;\nconfig.plugins = { ${plugins.join(", ")} };\nexport default [config];\n`;
  const jsPlugins = [{ name: probePluginName, specifier: join(here, "probe.mjs") }];
  if (testCase.suite === "baseline") {
    jsPlugins.push({ name: productPluginName, specifier: paths.product });
  }
  const oxlint = JSON.stringify({
    plugins: [],
    categories: { correctness: "off" },
    jsPlugins,
    rules,
  });
  writeFileSync(join(directory, hosts.eslint.configFile), eslint);
  writeFileSync(join(directory, hosts.oxlint.configFile), oxlint);
  return { eslint, oxlint };
}

function lint(tool, paths, testCase, directory, phase = "inspect") {
  const file = `input.${testCase.extension}`;
  const flags = phase === "inspect" ? [] : ["--fix"];
  if (phase === "suggest" && tool !== "eslint") flags.push("--fix-suggestions");
  const common = ["--no-ignore", "-f", "json", ...flags, file];
  const config = hosts[tool].configFile;
  const artifact = `${tool}-${testCase.id}-${phase}`;
  if (tool === "bun") {
    const typeAware = requiresTypes(testCase) ? ["--type-aware"] : [];
    return execute(paths.bun, ["lint", "-c", config, ...typeAware, ...common], directory, artifact);
  }
  const cli = tool === "eslint" ? paths.eslint : paths.oxlint;
  return execute(process.execPath, [cli, "-c", config, ...common], directory, artifact);
}

try {
  const dependencies = profile === "latest" ? join(here, "results", "latest-tools") : here;
  const require = createRequire(join(dependencies, "package.json"));
  const bunRequire = createRequire(require.resolve("bun/package.json"));
  const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
  if (!["darwin", "linux"].includes(process.platform) || !["x64", "arm64"].includes(process.arch)) {
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
  for (const testCase of cases) {
    const directory = join(work, testCase.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `input.${testCase.extension}`), testCase.code);
  }
  for (const tool of hostNames) {
    for (const testCase of cases) {
      const directory = join(work, testCase.id);
      const input = join(directory, `input.${testCase.extension}`);
      writeFileSync(input, testCase.code);
      const configs = configFor(testCase, paths, directory);
      const run = lint(tool, paths, testCase, directory);
      const fixes = {};
      const extraRuns = [];
      if (testCase.expectedFix && !run.error && !run.signal && run.exitCode === 0) {
        const fixed = lint(tool, paths, testCase, directory, "fix");
        extraRuns.push(fixed);
        const expectedCode = `${testCase.code.slice(0, testCase.expectedFix.range[0])}${testCase.expectedFix.text}${testCase.code.slice(testCase.expectedFix.range[1])}`;
        fixes.fixMatched = fixRunMatches(tool, fixed, read(input), expectedCode);
        if (tool === "eslint") {
          try {
            const sentinel = parseDiagnostics(tool, run.stdout, testCase.code).find(
              (message) => message.ruleId === probeRuleId,
            );
            fixes.suggestionsMatched = isDeepStrictEqual(
              sentinel?.suggestions?.map(({ desc, fix }) => ({ desc, fix })),
              testCase.expectedSuggestions,
            );
          } catch (error) {
            fixes.suggestionsMatched = false;
            fixes.suggestionError = error.message;
          }
          fixes.suggestionMethod = "diagnostic suggestion payload";
        } else {
          writeFileSync(input, testCase.code);
          configFor(testCase, paths, directory, true);
          const suggested = lint(tool, paths, testCase, directory, "suggest");
          extraRuns.push(suggested);
          const suggestion = testCase.expectedSuggestions[0].fix;
          const expectedSuggestion = `${testCase.code.slice(0, suggestion.range[0])}${suggestion.text}${testCase.code.slice(suggestion.range[1])}`;
          fixes.suggestionsMatched = fixRunMatches(
            tool,
            suggested,
            read(input),
            expectedSuggestion,
          );
          fixes.suggestionMethod = "isolated --fix-suggestions application";
        }
        writeFileSync(input, testCase.code);
        configFor(testCase, paths, directory);
      }
      const result = assess(testCase, tool, run, fixes);
      const recordRun = ({ stdout, stderr, ...metadata }) => metadata;
      report.results.push({
        ...result,
        tool,
        expected: testCase.expected,
        fixtureSha256: hash(testCase.code),
        configSha256: hash(tool === "oxlint" ? configs.oxlint : configs.eslint),
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
