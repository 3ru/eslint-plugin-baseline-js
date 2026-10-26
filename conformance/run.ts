import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  type Failure,
  type HostMeasurement,
  type ProfileMeasurement,
  parseProfileMeasurement,
  parseRunIdentity,
  profiles,
} from "../docs/website/lib/compatibility-report.ts";
import { assess, renderReport } from "./assess.ts";
import { cases, requiresTypes } from "./cases.ts";
import { configFiles, hostNames, hosts } from "./hosts.ts";
import { probePluginName, probeRuleId, productPluginName, productRuleId } from "./protocol.mjs";
import { copySubject, frozenInstallArgs } from "./subject.ts";
import type {
  Case,
  Format,
  HostName,
  ProbeOptions,
  Report,
  Run,
  RunRecord,
  ToolPaths,
} from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repository = dirname(here);
const hash = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex");
const read = (path: string): string => readFileSync(path, "utf8");
const problem = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const notMeasured = (reason: string): Failure => ({ kind: "not-measured", reason });

function packageVersion(path: string): string {
  const value: unknown = JSON.parse(read(path));
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    value.version.length === 0
  ) {
    throw new Error(`Package manifest has no version: ${path}`);
  }
  return value.version;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      subject: { type: "string" },
      tools: { type: "string" },
      context: { type: "string" },
    },
  });
  const requestedProfile = process.env.CONFORMANCE_PROFILE ?? "pinned";
  const profile = profiles.find((name) => name === requestedProfile);
  if (!profile)
    throw new Error(`Unknown CONFORMANCE_PROFILE '${requestedProfile}'. Use pinned or latest.`);
  if (values.context && !values.subject)
    throw new Error("Publication --context requires a prepared npm --subject directory.");
  const output = resolve(values.out ?? join(here, "results", profile));
  for (const input of [values.subject, values.tools]) {
    if (!input) continue;
    const path = relative(output, resolve(input));
    if (
      !isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
      throw new Error(
        "Subject and tools inputs must be outside --out. Use separate input and output directories.",
      );
    }
  }
  for (const path of [
    "raw",
    "work",
    "tools",
    "subject-input",
    "identity.json",
    "profile.json",
    "report.json",
    "report.md",
  ]) {
    rmSync(join(output, path), { recursive: true, force: true });
  }
  mkdirSync(join(output, "raw"), { recursive: true });
  const report: Report & Required<Pick<Report, "tools" | "hostErrors">> = {
    capturedAt: new Date().toISOString(),
    profile,
    policy: { available: 2019, includeWebApis: true, includeJsBuiltins: true },
    results: [],
    tools: {},
    hostErrors: {},
  };
  let publicProfile: ProfileMeasurement = notMeasured("Collection has not completed shared setup.");

  function save(): void {
    report.expectationMatched =
      !report.error &&
      Object.keys(report.hostErrors).length === 0 &&
      report.results.length === cases.length * hostNames.length &&
      report.results.every((row) => row.expectationMatched);
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(output, "report.md"), renderReport(report));
    writeFileSync(
      join(output, "profile.json"),
      `${JSON.stringify(parseProfileMeasurement(publicProfile, cases), null, 2)}\n`,
    );
  }

  function execute(
    command: string,
    args: readonly string[],
    cwd: string,
    artifact: string,
    timeout = 30000,
  ): Run {
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    const run: Run = {
      command: [command, ...args],
      cwd,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      raw: { stdout: `raw/${artifact}.stdout`, stderr: `raw/${artifact}.stderr` },
    };
    writeFileSync(join(output, `raw/${artifact}.stdout`), run.stdout);
    writeFileSync(join(output, `raw/${artifact}.stderr`), run.stderr);
    return run;
  }

  function requiredCommand(
    command: string,
    args: readonly string[],
    cwd: string,
    artifact: string,
    timeout = 30000,
  ): string {
    const run = execute(command, args, cwd, artifact, timeout);
    if (run.exitCode !== 0 || run.error) {
      throw new Error(
        `${artifact} failed: ${(run.error || run.stderr.trim() || run.stdout.trim() || `exit ${run.exitCode}`).slice(0, 4000)}`,
      );
    }
    return run.stdout.trimEnd();
  }

  function configFor(testCase: Case, paths: ToolPaths): Record<Format, string> {
    const needsTypes = requiresTypes(testCase);
    const probeOptions: ProbeOptions = { check: testCase.check };
    if (testCase.member !== undefined) probeOptions.member = testCase.member;
    const rules: Record<string, unknown> = { [probeRuleId]: ["warn", probeOptions] };
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
    const typescript = testCase.extension === "ts";
    const languageOptions: Record<string, unknown> = {
      ecmaVersion: "latest",
      sourceType: "module",
    };
    if (needsTypes)
      languageOptions.parserOptions = {
        project: join(output, "work", "tsconfig.json"),
        tsconfigRootDir: join(output, "work"),
      };
    const imports = [
      `import probe from ${JSON.stringify(pathToFileURL(join(here, "probe.mjs")).href)};`,
    ];
    if (typescript)
      imports.push(`import parser from ${JSON.stringify(pathToFileURL(paths.parser).href)};`);
    if (testCase.suite === "baseline")
      imports.push(`import baseline from ${JSON.stringify(pathToFileURL(paths.product).href)};`);
    const plugins = [`'${probePluginName}': probe`];
    if (testCase.suite === "baseline") plugins.push(`'${productPluginName}': baseline`);
    const eslint = `${[
      ...imports,
      `const config = ${JSON.stringify({ files: ["**/*.{js,ts}"], languageOptions, rules })};`,
      ...(typescript ? ["config.languageOptions.parser = parser;"] : []),
      `config.plugins = { ${plugins.join(", ")} };`,
      "export default [config];",
    ].join("\n")}\n`;
    const jsPlugins = [join(here, "probe.mjs")];
    if (testCase.suite === "baseline") jsPlugins.push(paths.product);
    return {
      eslint,
      oxlint: JSON.stringify({ plugins: [], categories: { correctness: "off" }, jsPlugins, rules }),
    };
  }

  function executableFor(tool: HostName, require: NodeJS.Require): string {
    switch (tool) {
      case "eslint":
        return join(dirname(require.resolve("eslint/package.json")), "bin", "eslint.js");
      case "oxlint":
        return join(dirname(require.resolve("oxlint/package.json")), "bin", "oxlint");
      case "bun":
        break;
      default: {
        const unhandled: never = tool;
        throw new Error(`No executable resolver for ${unhandled}.`);
      }
    }
    if (
      !["darwin", "linux"].includes(process.platform) ||
      !["x64", "arm64"].includes(process.arch)
    ) {
      throw new Error("Bun collection supports macOS and glibc Linux on x64/arm64.");
    }
    if (process.platform === "linux") {
      const diagnostic: unknown = process.report?.getReport();
      if (
        typeof diagnostic !== "object" ||
        diagnostic === null ||
        !("header" in diagnostic) ||
        typeof diagnostic.header !== "object" ||
        diagnostic.header === null ||
        !("glibcVersionRuntime" in diagnostic.header)
      ) {
        throw new Error("Bun collection requires glibc Linux.");
      }
    }
    const bunRequire = createRequire(require.resolve("bun/package.json"));
    const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
    return join(
      dirname(bunRequire.resolve(`@oven/bun-${process.platform}-${architecture}/package.json`)),
      "bin",
      "bun",
    );
  }

  save();
  try {
    report.source = {
      commit: requiredCommand("git", ["rev-parse", "HEAD"], repository, "harness-commit"),
      dirty: requiredCommand("git", ["status", "--porcelain"], repository, "harness-status")
        .split("\n")
        .filter(Boolean),
    };
    report.environment = {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    };
    const subjectDirectory = join(output, "subject-input");
    if (values.subject) {
      report.subject = copySubject(resolve(values.subject), subjectDirectory);
      if (values.context) {
        const run = parseRunIdentity(JSON.parse(read(resolve(values.context))));
        if (run.commit !== report.source.commit)
          throw new Error("Publication context commit differs from the checked-out harness HEAD.");
        writeFileSync(
          join(output, "identity.json"),
          `${JSON.stringify(
            {
              run,
              profile,
              subject: report.subject,
              paths: { repository, output, home: homedir(), node: process.execPath },
            },
            null,
            2,
          )}\n`,
        );
      }
      requiredCommand("pnpm", frozenInstallArgs, subjectDirectory, "subject-install", 120000);
    } else {
      requiredCommand("pnpm", ["build"], repository, "checkout-build", 120000);
    }
    const dependencies = join(output, "tools");
    if (values.tools || profile === "pinned") {
      mkdirSync(dependencies, { recursive: true });
      for (const file of ["package.json", "pnpm-lock.yaml"]) {
        copyFileSync(join(resolve(values.tools ?? here), file), join(dependencies, file));
      }
      requiredCommand("pnpm", frozenInstallArgs, dependencies, "tools-install", 120000);
    } else {
      requiredCommand(
        process.execPath,
        [join(here, "refresh.ts"), "--out", dependencies],
        here,
        "tools-install",
        180000,
      );
    }
    const require = createRequire(join(dependencies, "package.json"));
    const parser = require.resolve("@typescript-eslint/parser");
    const product = values.subject
      ? createRequire(join(subjectDirectory, "package.json")).resolve("eslint-plugin-baseline-js")
      : join(repository, "dist", "index.mjs");
    const productRequire = createRequire(product);
    report.product = {
      source: values.subject ? "npm release" : "checkout dist build",
      version: values.subject
        ? packageVersion(productRequire.resolve("eslint-plugin-baseline-js/package.json"))
        : packageVersion(join(repository, "package.json")),
      imports: Object.fromEntries(
        ["eslint", "eslint-plugin-es-x"].map((name) => [
          name,
          packageVersion(productRequire.resolve(`${name}/package.json`)),
        ]),
      ),
      importPaths: Object.fromEntries(
        ["eslint", "eslint-plugin-es-x"].map((name) => [name, productRequire.resolve(name)]),
      ),
    };
    if (report.subject && report.product.version !== report.subject.version)
      throw new Error("Installed npm subject version differs from subject.json.");
    report.dependencies = Object.fromEntries(
      ["@typescript-eslint/parser", "typescript"].map((name) => [
        name,
        packageVersion(require.resolve(`${name}/package.json`)),
      ]),
    );
    report.dependencyManifestSha256 = hash(readFileSync(join(dependencies, "package.json")));
    report.dependencyLockSha256 = hash(readFileSync(join(dependencies, "pnpm-lock.yaml")));
    const harnessFiles = readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `conformance/${entry.name}`);
    report.inputs = Object.fromEntries(
      [...harnessFiles, "docs/website/lib/compatibility-report.ts"].map((path) => [
        path,
        hash(readFileSync(join(repository, path))),
      ]),
    );
    report.inputs["product-entry"] = hash(readFileSync(product));
    for (const file of ["package.json", "pnpm-lock.yaml"]) {
      report.inputs[`subject-input/${file}`] = hash(
        readFileSync(join(values.subject ? subjectDirectory : repository, file)),
      );
    }
    const measurement: Extract<ProfileMeasurement, { kind: "measured" }> = {
      kind: "measured",
      capturedAt: report.capturedAt,
      parser: report.dependencies["@typescript-eslint/parser"] ?? "unavailable",
      typescript: report.dependencies.typescript ?? "unavailable",
      hosts: {
        eslint: notMeasured("ESLint collection has not started."),
        oxlint: notMeasured("Oxlint collection has not started."),
        bun: notMeasured("Bun collection has not started."),
      },
    };
    publicProfile = measurement;
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
    save();
    for (const tool of hostNames) {
      try {
        const executable = executableFor(tool, require);
        const version = requiredCommand(
          tool === "bun" ? executable : process.execPath,
          tool === "bun" ? ["--revision"] : [executable, "--version"],
          dependencies,
          `${tool}-version`,
        ).replace(/^Version: /u, "");
        if (version.length === 0) throw new Error(`${tool} version command returned no version.`);
        const installedVersion = packageVersion(require.resolve(`${tool}/package.json`));
        report.dependencies[tool] = installedVersion;
        report.tools[tool] = {
          version,
          ...(tool === "bun" ? { binarySha256: hash(readFileSync(executable)) } : {}),
        };
        const hostMeasurement: Extract<HostMeasurement, { kind: "measured" }> = {
          kind: "measured",
          packageVersion: installedVersion,
          reportedVersion: version,
          channel: tool === "bun" ? "canary" : profile,
          cases: Object.fromEntries(
            cases.map(({ id }) => [id, notMeasured("Case collection has not completed.")]),
          ),
        };
        measurement.hosts[tool] = hostMeasurement;
        const host = hosts[tool];
        const paths: ToolPaths = { parser, product, executable };
        for (const testCase of cases) {
          const directory = join(work, testCase.id);
          const config = configFiles[host.format];
          writeFileSync(join(directory, config), configFor(testCase, paths)[host.format]);
          const args = [
            "-c",
            config,
            ...(requiresTypes(testCase) ? host.typedFlags : []),
            "--no-ignore",
            "-f",
            "json",
            `input.${testCase.extension}`,
          ];
          const invocation = host.invoke(paths, args);
          const run = execute(
            invocation.command,
            invocation.args,
            directory,
            `${tool}-${testCase.id}-inspect`,
          );
          run.config = config;
          run.configSha256 = hash(readFileSync(join(directory, config)));
          const result = assess(testCase, host, run);
          const { stdout, stderr, ...metadata }: Run = run;
          const record: RunRecord = metadata;
          report.results.push({
            ...result,
            tool,
            expected: testCase.expected,
            fixtureSha256: hash(testCase.code),
            run: record,
          });
          hostMeasurement.cases[testCase.id] = {
            kind: "observed",
            capability: result.capability,
            correctness: result.correctness,
            status: result.status,
            expectationMatched: result.expectationMatched,
            reason: result.reason ?? null,
          };
          console.log(
            `${tool}: ${testCase.id}: ${result.status}${result.expectationMatched ? "" : " (unexpected)"}`,
          );
          save();
        }
      } catch (error) {
        const reason = problem(error);
        report.hostErrors[tool] = reason;
        const hostMeasurement = measurement.hosts[tool];
        if (hostMeasurement.kind === "measured") {
          for (const [id, observation] of Object.entries(hostMeasurement.cases)) {
            if (observation.kind === "not-measured")
              hostMeasurement.cases[id] = notMeasured(reason);
          }
        } else measurement.hosts[tool] = notMeasured(reason);
        console.error(`${tool}: ${reason}`);
        save();
      }
    }
  } catch (error) {
    report.error = problem(error);
    if (publicProfile.kind === "not-measured") publicProfile = notMeasured(report.error);
    console.error(report.error);
  } finally {
    save();
    if (!report.expectationMatched) process.exitCode = 1;
  }
}

await main().catch((error: unknown) => {
  console.error(problem(error));
  process.exitCode = 1;
});
