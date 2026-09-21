import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { reportingPolicyFor } from "./utils/policy";

async function ensureTsParser(): Promise<unknown | null> {
  try {
    const p = await import("@typescript-eslint/parser");
    return p.default;
  } catch {
    return null;
  }
}

describe("typed builtins detection (Intl.Locale, Iterator, Uint8Array instance)", () => {
  it("reports intl-locale-info and iterator-methods when typed is available", async () => {
    const tsParser = await ensureTsParser();
    if (!tsParser) {
      expect(true).toBe(true);
      return;
    }

    const tmp = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-typed-builtins-"));
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
      // Intl.Locale info → getCalendars() maps to intl-locale-info
      const lc = new Intl.Locale('en-US');
      const cals = lc.getCalendars();
      // Iterator helpers → using ambient Iterator type below
      declare function getIter(): Iterator<number>;
      const it = getIter();
      const it2 = it.map(x => x + 1);
      // Uint8Array instance toHex → uint8array-base64-hex
      const u = new Uint8Array([1,2,3]);
      const hex = u.toHex();
    `;
    await fs.writeFile(samplePath, code, "utf8");

    const ambient = `
      declare global {
        namespace Intl {
          interface Locale {
            getCalendars(): string[];
            getCollations(): string[];
            getHourCycles(): string[];
            getNumberingSystems(): string[];
            getTextInfo(): { direction: string };
            getTimeZones(): string[];
            getWeekInfo(): { firstDay: number };
          }
        }
        interface Iterator<T, TReturn = any, TNext = unknown> {
          map<U>(fn: (v: T) => U): Iterator<U, TReturn, TNext>;
        }
        interface Uint8Array {
          toHex(): string;
        }
      }
      export {};
    `;
    await fs.writeFile(ambientPath, ambient, "utf8");

    const plugin = (await import("../dist/index.mjs")).default;

    // ESLint v9 requires a config file path when using overrideConfig arrays.
    const flatConfigPath = join(tmp, "eslint.config.mjs");
    await fs.writeFile(flatConfigPath, "export default [{}]\n", "utf8");

    const eslint = new ESLint({
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
                available: reportingPolicyFor(
                  "intl-locale-info",
                  "iterator-methods",
                  "uint8array-base64-hex",
                ),
                includeJsBuiltins: { preset: "type-aware" },
              },
            ],
          },
        },
      ],
    });

    const results = await eslint.lintFiles([samplePath]);
    const msgs = results
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"))
      .map((m) => m.message);
    for (const id of ["intl-locale-info", "iterator-methods", "uint8array-base64-hex"]) {
      expect(
        msgs.some((m) => m.includes(`(${id})`)),
        id,
      ).toBe(true);
    }
  }, 15000);

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
      // SharedArrayBuffer options (newWithOptions) → resizable-buffers, typed only
      new SharedArrayBuffer(8, { maxByteLength: 16, growable: true });
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
    expect(msgsTyped.some((m) => /\(resizable-buffers\)/.test(m.message))).toBe(true);

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
    expect(msgsTyped.filter((m) => /\(getorinsert\)/.test(m.message))).toHaveLength(4);

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
