import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import type { CommonRuleOptions } from "../../src/config";

export async function createTypedFixture(
  source: string,
  {
    target = "ES2023",
    lib = [target, "DOM"],
    libReplacement,
  }: { target?: "ES2023" | "ESNext"; lib?: string[]; libReplacement?: boolean } = {},
) {
  const root = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-typed-fixture-"));
  try {
    const samplePath = join(root, "sample.ts");
    const tsconfigPath = join(root, "tsconfig.json");
    const config = {
      compilerOptions: {
        target,
        module: "ESNext",
        moduleResolution: "Bundler",
        lib,
        libReplacement,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["sample.ts"],
    };
    await fs.writeFile(samplePath, `${source}\nexport {};\n`);
    await fs.writeFile(tsconfigPath, JSON.stringify(config));
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, tsconfigPath);
    if (parsed.errors.length) {
      throw new Error(
        parsed.errors
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
          .join("\n"),
      );
    }
    return { root, samplePath, tsconfigPath, compilerOptions: parsed.options };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

export type TypedFixture = Awaited<ReturnType<typeof createTypedFixture>>;

export async function lintTypedFixture(fixture: TypedFixture, options: CommonRuleOptions) {
  const parser = (await import("@typescript-eslint/parser")).default;
  const plugin = (await import("../../dist/index.mjs")).default;
  const eslint = new ESLint({
    cwd: fixture.root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser,
          parserOptions: {
            project: [fixture.tsconfigPath],
            tsconfigRootDir: fixture.root,
            // Repeated option checks are separate lint passes, not an autofix cycle.
            disallowAutomaticSingleRunInference: true,
          },
        },
        plugins: { "baseline-js": { meta: plugin.meta, rules: plugin.rules } },
        rules: { "baseline-js/use-baseline": ["error", options] },
      },
    ],
  });
  const results = await eslint.lintFiles([fixture.samplePath]);
  return results.flatMap((result) => result.messages);
}
