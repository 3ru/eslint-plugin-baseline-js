import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("typed Web API detection", () => {
  it("reports and ignores heading offset properties", async () => {
    // web-features: https://github.com/web-platform-dx/web-features/blob/v3.34.3/features/heading-offset.yml
    // spec: https://html.spec.whatwg.org/multipage/sections.html#heading-levels-&-offsets
    const parser = (await import("@typescript-eslint/parser")).default;
    const root = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-heading-offset-"));
    const srcDir = join(root, "src");
    const tsconfigPath = join(root, "tsconfig.json");
    const samplePath = join(srcDir, "sample.ts");
    await fs.mkdir(srcDir);
    await fs.writeFile(
      tsconfigPath,
      JSON.stringify({
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
      }),
      "utf8",
    );
    await fs.writeFile(
      join(srcDir, "ambient.d.ts"),
      `
        declare global {
          interface HTMLElement {
            headingOffset: number;
            headingReset: boolean;
          }
        }
        export {};
      `,
      "utf8",
    );
    await fs.writeFile(
      samplePath,
      `
        const element = document.createElement("div");
        element.headingOffset;
        element.headingReset;
        element.id;
      `,
      "utf8",
    );
    const configPath = join(root, "eslint.config.mjs");
    await fs.writeFile(configPath, "export default [{}]\n", "utf8");
    const plugin = (await import("../dist/index.mjs")).default;

    async function lint(ignoreFeatures: string[] = []) {
      const eslint = new ESLint({
        cwd: root,
        overrideConfigFile: configPath,
        overrideConfig: [
          {
            files: ["**/*.ts"],
            languageOptions: {
              parser,
              parserOptions: { project: [tsconfigPath], tsconfigRootDir: root },
            },
            plugins: { "baseline-js": plugin },
            rules: {
              "baseline-js/use-baseline": [
                "error",
                {
                  available: "widely",
                  includeWebApis: { preset: "type-aware", only: ["heading-offset"] },
                  includeJsBuiltins: false,
                  ignoreFeatures,
                },
              ],
            },
          },
        ],
      });
      const results = await eslint.lintFiles([samplePath]);
      return results
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === "baseline-js/use-baseline");
    }

    const messages = await lint();
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.message.includes("(heading-offset)"))).toBe(true);
    await expect(lint(["heading-offset"])).resolves.toHaveLength(0);
  }, 15000);
});
