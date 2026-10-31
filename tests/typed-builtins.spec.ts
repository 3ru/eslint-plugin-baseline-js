import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { reportingPolicyFor } from "./utils/policy";
import { createTypedFixture, lintTypedFixture } from "./utils/typed-fixture";

async function ensureTsParser(): Promise<unknown | null> {
  try {
    const p = await import("@typescript-eslint/parser");
    return p.default;
  } catch {
    return null;
  }
}

describe("typed builtins detection (Intl.Locale, Iterator, Uint8Array instance)", () => {
  it("reports standard builtins and skips user-added iterator members", async () => {
    const fixture = await createTypedFixture(
      `
      new Intl.Locale('en-US').getCalendars();
      Iterator.from([1, 2]).map(x => x + 1);
      new Uint8Array([1, 2, 3]).toHex();
      declare global {
        interface IteratorObject<T, TReturn, TNext> { join(separator?: string): string; }
      }
      Iterator.from([1, 2]).join(',');
      [1, 2].values().join(',');
      [1, 2].join(',');
      const custom = { join: (separator: string) => separator };
      custom.join(',');
    `,
      { target: "ESNext" },
    );
    try {
      const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
      expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
      const messages = await lintTypedFixture(fixture, {
        available: reportingPolicyFor(
          "intl-locale-info",
          "iterator-methods",
          "iterator-join",
          "uint8array-base64-hex",
        ),
        includeJsBuiltins: {
          preset: "type-aware",
          only: ["intl-locale-info", "iterator-methods", "iterator-join", "uint8array-base64-hex"],
        },
      });
      expect(messages.some((message) => message.fatal)).toBe(false);
      expect(
        messages.map((message) => [
          message.line,
          message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
        ]),
      ).toEqual([
        [2, "intl-locale-info"],
        [3, "iterator-methods"],
        [3, "iterator-methods"],
        [4, "uint8array-base64-hex"],
        [8, "iterator-methods"],
      ]);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("detects iterator members supplied by a compiler-selected replacement library", async () => {
    const fixture = await createTypedFixture(
      "declare const iterator: Iterator<number>; iterator.join(',');",
      {
        target: "ESNext",
        lib: ["ES2023", "ESNext"],
        libReplacement: true,
      },
    );
    try {
      const libraryRoot = join(fixture.root, "node_modules/@typescript/lib-esnext");
      await fs.mkdir(libraryRoot, { recursive: true });
      await fs.writeFile(
        join(libraryRoot, "package.json"),
        JSON.stringify({ name: "@typescript/lib-esnext", version: "1.0.0", types: "index.d.ts" }),
      );
      await fs.writeFile(
        join(libraryRoot, "index.d.ts"),
        "interface Iterator<T, TReturn = any, TNext = any> { join(separator?: string): string; }",
      );
      const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
      expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
      const library = program.getSourceFile(await fs.realpath(join(libraryRoot, "index.d.ts")));
      expect(library && program.isSourceFileDefaultLibrary(library)).toBe(true);
      const messages = await lintTypedFixture(fixture, {
        available: reportingPolicyFor("iterator-join"),
        includeJsBuiltins: { preset: "type-aware", only: ["iterator-join"] },
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain("Feature ID: iterator-join.");
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports resizable-buffers (SharedArrayBuffer options) only when typed is available", async () => {
    const tsParser = await ensureTsParser();
    if (!tsParser) {
      expect(true).toBe(true);
      return;
    }

    const tmp = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-typed-sab-"));
    const tsconfigPath = join(tmp, "tsconfig.json");
    const srcDir = join(tmp, "src");
    await fs.mkdir(srcDir);
    const samplePath = join(srcDir, "sample.ts");

    const tsconfig = {
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2023", "ESNext", "DOM"],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    };
    await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");

    const code = `
      new SharedArrayBuffer(8, { maxByteLength: 16 });
    `;
    await fs.writeFile(samplePath, code, "utf8");

    const plugin = (await import("../dist/index.mjs")).default;
    const flatConfigPath = join(tmp, "eslint.config.mjs");
    await fs.writeFile(flatConfigPath, "export default [{}]\n", "utf8");

    // Typed-aware run → should report
    const eslintTyped = new ESLint({
      cwd: tmp,
      overrideConfigFile: flatConfigPath,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser: tsParser,
            parserOptions: { project: [tsconfigPath], tsconfigRootDir: tmp },
          },
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              {
                available: reportingPolicyFor("resizable-buffers"),
                includeJsBuiltins: { preset: "type-aware" },
              },
            ],
          },
        },
      ],
    });
    const resultsTyped = await eslintTyped.lintFiles([samplePath]);
    const msgsTyped = resultsTyped
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    expect(msgsTyped.some((m) => /Feature ID: resizable-buffers\./.test(m.message))).toBe(true);

    // Non-typed (safe preset) run → should not report due to typedOnly gating
    const eslintUntyped = new ESLint({
      cwd: tmp,
      overrideConfigFile: flatConfigPath,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: {},
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              {
                available: reportingPolicyFor("resizable-buffers"),
                includeJsBuiltins: { preset: "safe" },
              },
            ],
          },
        },
      ],
    });
    const resultsUntyped = await eslintUntyped.lintFiles([samplePath]);
    const msgsUntyped = resultsUntyped
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    // the sample must parse without a TS parser, otherwise this check is vacuous
    expect(resultsUntyped.flatMap((r) => r.messages).some((m) => m.fatal)).toBe(false);
    expect(msgsUntyped.length).toBe(0);
  }, 20000);

  it("reports Map/WeakMap getOrInsert only when typed declarations are available", async () => {
    const tsParser = await ensureTsParser();
    if (!tsParser) {
      expect(true).toBe(true);
      return;
    }

    const tmp = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-typed-getorinsert-"));
    const tsconfigPath = join(tmp, "tsconfig.json");
    const srcDir = join(tmp, "src");
    await fs.mkdir(srcDir);
    const samplePath = join(srcDir, "sample.ts");
    const ambientPath = join(srcDir, "ambient.d.ts");

    const tsconfig = {
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2023", "ESNext", "DOM"],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    };
    await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");

    const code = `
      const map = new Map<string, number>();
      map.getOrInsert("alpha", 1);
      map.getOrInsertComputed("beta", () => 2);

      const weak = new WeakMap<object, number>();
      const key = {};
      weak.getOrInsert(key, 1);
      weak.getOrInsertComputed(key, () => 2);
    `;
    await fs.writeFile(samplePath, code, "utf8");
    // Same calls as plain JavaScript, outside the TypeScript program, so the
    // default parser can lint them.
    const plainPath = join(tmp, "plain.js");
    await fs.writeFile(
      plainPath,
      `
      const map = new Map();
      map.getOrInsert("alpha", 1);
      map.getOrInsertComputed("beta", () => 2);

      const weak = new WeakMap();
      const key = {};
      weak.getOrInsert(key, 1);
      weak.getOrInsertComputed(key, () => 2);
    `,
      "utf8",
    );

    const ambient = `
      declare global {
        interface Map<K, V> {
          getOrInsert(key: K, defaultValue: V): V;
          getOrInsertComputed(key: K, compute: (key: K) => V): V;
        }
        interface WeakMap<K extends WeakKey, V> {
          getOrInsert(key: K, defaultValue: V): V;
          getOrInsertComputed(key: K, compute: (key: K) => V): V;
        }
      }
      export {};
    `;
    await fs.writeFile(ambientPath, ambient, "utf8");

    const plugin = (await import("../dist/index.mjs")).default;
    const flatConfigPath = join(tmp, "eslint.config.mjs");
    await fs.writeFile(flatConfigPath, "export default [{}]\n", "utf8");

    const eslintTyped = new ESLint({
      cwd: tmp,
      overrideConfigFile: flatConfigPath,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser: tsParser,
            parserOptions: { project: [tsconfigPath], tsconfigRootDir: tmp },
          },
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              {
                available: reportingPolicyFor("getorinsert"),
                includeJsBuiltins: { preset: "type-aware" },
              },
            ],
          },
        },
      ],
    });
    const resultsTyped = await eslintTyped.lintFiles([samplePath]);
    const msgsTyped = resultsTyped
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    expect(msgsTyped.filter((m) => /Feature ID: getorinsert\./.test(m.message))).toHaveLength(4);

    const eslintUntyped = new ESLint({
      cwd: tmp,
      overrideConfigFile: flatConfigPath,
      overrideConfig: [
        {
          files: ["**/*.js"],
          languageOptions: {},
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              {
                available: reportingPolicyFor("getorinsert"),
                includeJsBuiltins: { preset: "safe" },
              },
            ],
          },
        },
      ],
    });
    // the rule must apply to the file, otherwise a zero-message result is vacuous
    const untypedConfig = await eslintUntyped.calculateConfigForFile(plainPath);
    expect(untypedConfig?.rules?.["baseline-js/use-baseline"]).toBeDefined();
    const resultsUntyped = await eslintUntyped.lintFiles([plainPath]);
    const msgsUntyped = resultsUntyped
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    // the sample must parse without a TS parser, otherwise this check is vacuous
    expect(resultsUntyped.flatMap((r) => r.messages).some((m) => m.fatal)).toBe(false);
    expect(msgsUntyped.length).toBe(0);
  }, 20000);
});
