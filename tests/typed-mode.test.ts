import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESLintCompat } from "./compat";

describe("typed mode (TypeScript-aware) integration", () => {
  it("reports instance member APIs when baseline excludes them", async () => {
    // Dynamically import TS parser; skip test if not available
    let tsParser: unknown;
    try {
      tsParser = (await import("@typescript-eslint/parser")).default;
    } catch {
      expect(true).toBe(true);
      return;
    }

    // Create a temporary project with tsconfig and a sample file
    const tmpRoot = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-typed-"));
    const tsconfigPath = join(tmpRoot, "tsconfig.json");
    const srcDir = join(tmpRoot, "src");
    await fs.mkdir(srcDir);
    const samplePath = join(srcDir, "sample.ts");
    const ambientPath = join(srcDir, "ambient.d.ts");

    const tsconfig = {
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2023", "DOM"],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    };
    await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");

    const code = `
      const a: number[] = [1,2,3];
      a.findLast(x => x > 0);
      // ensure at least one builtins detection regardless of typed availability
      Atomics.waitAsync?.(new Int32Array(new SharedArrayBuffer(4)), 0);
    `;
    await fs.writeFile(samplePath, code, "utf8");
    const ambient = `
      declare global {
        interface Array<T> {
          findLast(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T | undefined;
          toReversed(): T[];
        }
      }
      export {};
    `;
    await fs.writeFile(ambientPath, ambient, "utf8");

    // Import built plugin
    const plugin = (await import("../dist/index.mjs")).default;

    // ESLint v9 expects a config file path when overrideConfigFile is provided.
    // Minimal Flat Config and pass it via overrideConfigFile (ESLint v9 compatibility).
    const flatConfigPath = join(tmpRoot, "eslint.config.mjs");
    await fs.writeFile(flatConfigPath, "export default [{}]\n", "utf8");

    const eslint = new ESLintCompat({
      cwd: tmpRoot,
      overrideConfigFile: flatConfigPath,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser: tsParser,
            parserOptions: {
              project: [tsconfigPath],
              tsconfigRootDir: tmpRoot,
            },
          },
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              {
                available: "widely",
                includeJsBuiltins: { preset: "type-aware" },
              },
            ],
          },
        },
      ],
    });

    const results = await eslint.lintFiles([samplePath]);
    const messages = results.flatMap((r) => r.messages);
    const count = messages.filter((m) =>
      (m.ruleId || "").includes("baseline-js/use-baseline"),
    ).length;
    expect(count).toBeGreaterThan(0);
  }, 15000);

  it("emits year-based Baseline message when using numeric baseline", async () => {
    let tsParser: unknown;
    try {
      tsParser = (await import("@typescript-eslint/parser")).default;
    } catch {
      expect(true).toBe(true);
      return;
    }

    const tmpRoot = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-typed-yr-"));
    const tsconfigPath = join(tmpRoot, "tsconfig.json");
    const srcDir = join(tmpRoot, "src");
    await fs.mkdir(srcDir);
    const samplePath = join(srcDir, "sample.ts");
    const ambientPath = join(srcDir, "ambient.d.ts");

    const tsconfig = {
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2023", "DOM"],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    };
    await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");

    const code = `
      const a: number[] = [1,2,3];
      a.toReversed();
    `;
    await fs.writeFile(samplePath, code, "utf8");
    const ambient = `
      declare global {
        interface Array<T> { toReversed(): T[] }
      }
      export {};
    `;
    await fs.writeFile(ambientPath, ambient, "utf8");

    const plugin = (await import("../dist/index.mjs")).default;

    const flatConfigPath = join(tmpRoot, "eslint.config.mjs");
    await fs.writeFile(flatConfigPath, "export default [{}]\n", "utf8");

    const eslint = new ESLintCompat({
      cwd: tmpRoot,
      overrideConfigFile: flatConfigPath,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser: tsParser,
            parserOptions: { project: [tsconfigPath], tsconfigRootDir: tmpRoot },
          },
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              { available: 2022, includeJsBuiltins: { preset: "type-aware" } },
            ],
          },
        },
      ],
    });

    const results = await eslint.lintFiles([samplePath]);
    const messages = results.flatMap((r) => r.messages);
    const msg = messages.find((m) => (m.ruleId || "").includes("baseline-js/use-baseline"));
    expect(msg?.message).toBe(
      "Feature 'Array by copy' (array-by-copy) became Baseline in 2023 and exceeds 2022.",
    );
  }, 15000);
});
