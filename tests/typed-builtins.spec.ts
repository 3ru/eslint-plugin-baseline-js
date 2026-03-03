import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

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
      // Intl.Locale info (limited) → should report for getCalendars()
      const lc = new Intl.Locale('en-US');
      const cals = lc.getCalendars();
      // Intl.Locale base property (widely available) → should NOT report
      const lang = lc.language;
      // Iterator helpers (newly) → using ambient Iterator type below
      declare function getIter(): Iterator<number>;
      const it = getIter();
      const it2 = it.map(x => x + 1);
      // Uint8Array instance toHex (limited) → should report
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
              { available: "widely", includeJsBuiltins: { preset: "type-aware" } },
            ],
          },
        },
      ],
    });

    const results = await eslint.lintFiles([samplePath]);
    const msgs = results
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    expect(msgs.length).toBeGreaterThanOrEqual(2);
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
      // SharedArrayBuffer options (newWithOptions) → should report when typed
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
              { available: "widely", includeJsBuiltins: { preset: "type-aware" } },
            ],
          },
        },
      ],
    });
    const resultsTyped = await eslintTyped.lintFiles([samplePath]);
    const msgsTyped = resultsTyped
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    expect(msgsTyped.some((m) => /Resizable buffers/.test(m.message))).toBe(true);

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
              { available: "widely", includeJsBuiltins: { preset: "safe" } },
            ],
          },
        },
      ],
    });
    const resultsUntyped = await eslintUntyped.lintFiles([samplePath]);
    const msgsUntyped = resultsUntyped
      .flatMap((r) => r.messages)
      .filter((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    expect(msgsUntyped.length).toBe(0);
  }, 20000);
});
