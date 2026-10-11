import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { reportingPolicyFor } from "./utils/policy";

const fixtures = [
  {
    name: "direct, union, intersection and narrowed receivers",
    code: `
      declare const element: Element;
      element.checkVisibility();
      declare const union: Element | HTMLElement;
      union.checkVisibility();
      declare const intersection: Element & { extra: boolean };
      intersection.checkVisibility();
      declare const nullable: Element | null;
      if (nullable) nullable.checkVisibility();
    `,
    expected: ["check-visibility", "check-visibility", "check-visibility", "check-visibility"],
  },
  {
    name: "deeply inherited DOM members",
    code: `
      declare const div: HTMLDivElement;
      div.isConnected;
      div.getRootNode();
      interface CustomElement extends HTMLDivElement {}
      declare const custom: CustomElement;
      custom.checkVisibility();
      interface GenericElement<T> extends HTMLDivElement { marker?: T; }
      declare const generic: GenericElement<string>;
      generic.checkVisibility();
    `,
    expected: ["shadow-dom", "shadow-dom", "check-visibility", "check-visibility"],
  },
  {
    name: "nullable optional receivers",
    code: `
      declare const nullable: Element | null;
      nullable?.checkVisibility();
      declare const optional: Element | undefined;
      optional?.checkVisibility();
      declare const nullableDiv: HTMLDivElement | undefined;
      nullableDiv?.isConnected;
      document.querySelector("div")?.checkVisibility();
    `,
    expected: ["check-visibility", "check-visibility", "shadow-dom", "check-visibility"],
  },
  {
    name: "constrained generic receivers",
    code: `
      function direct<T extends Element>(element: T) { element.checkVisibility(); }
      function chained<U extends Element, T extends U>(element: T) {
        element.checkVisibility();
      }
      function intersection<T extends Element & { extra: boolean }>(element: T) {
        element.checkVisibility();
      }
    `,
    expected: ["check-visibility", "check-visibility", "check-visibility"],
  },
  {
    name: "unrelated receivers and shadowed names",
    code: `
      declare const arbitrary: any;
      arbitrary.checkVisibility();
      declare const unknownValue: unknown;
      (unknownValue as { checkVisibility(): boolean }).checkVisibility();
      const unrelated = {
        checkVisibility() { return true; },
        isConnected: true,
        getRootNode() { return {}; },
      };
      unrelated.checkVisibility();
      unrelated.isConnected;
      unrelated.getRootNode();
      function shadowed(Element: { checkVisibility(): boolean }) {
        Element.checkVisibility();
      }
      function unconstrained<T extends { checkVisibility(): boolean }>(element: T) {
        element.checkVisibility();
      }
    `,
    expected: [],
  },
];

describe("typed Web API receivers", () => {
  it.each(fixtures)(
    "handles $name",
    async ({ code, expected }) => {
      const parser = (await import("@typescript-eslint/parser")).default;
      const root = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-webapi-receivers-"));
      try {
        const samplePath = join(root, "sample.ts");
        const tsconfigPath = join(root, "tsconfig.json");
        const configPath = join(root, "eslint.config.mjs");
        const compilerOptions: ts.CompilerOptions = {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
          noEmit: true,
          strict: true,
          skipLibCheck: true,
        };
        await fs.writeFile(samplePath, `${code}\nexport {};\n`);
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
            include: ["sample.ts"],
          }),
        );
        await fs.writeFile(configPath, "export default [{}];\n");
        const program = ts.createProgram([samplePath], compilerOptions);
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
        ).toEqual([]);

        const plugin = (await import("../dist/index.mjs")).default;
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
                    available: reportingPolicyFor("check-visibility", "shadow-dom"),
                    includeWebApis: {
                      preset: "type-aware",
                      only: ["check-visibility", "shadow-dom"],
                    },
                    includeJsBuiltins: false,
                  },
                ],
              },
            },
          ],
        });
        const results = await eslint.lintFiles([samplePath]);
        expect(results.flatMap((result) => result.messages).some((message) => message.fatal)).toBe(
          false,
        );
        const messages = results
          .flatMap((result) => result.messages)
          .filter((message) => message.ruleId === "baseline-js/use-baseline");
        expect(messages.map((message) => message.message.match(/\(([^)]+)\)\.$/)?.[1])).toEqual(
          expected,
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    15000,
  );
});
