import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { reportingPolicyFor } from "./utils/policy";
import { createTypedFixture, lintTypedFixture } from "./utils/typed-fixture";

const webFeatures = ["check-visibility"];
const jsFeatures = ["set-methods", "string-wellformed", "intl-locale-info"];

const fixtures: Array<{
  name: string;
  code: string;
  files?: Record<string, string>;
  defaultLibraryPath?: string;
  expected: string[];
}> = [
  {
    name: "module-local classes with native names",
    code: `
      class Element { checkVisibility() { return true; } }
      new Element().checkVisibility();
      class Set<T> { union(other: Set<T>) { return other; } }
      new Set<number>().union(new Set<number>());
    `,
    expected: [],
  },
  {
    name: "module-local interfaces with native names",
    code: `
      interface Element { checkVisibility(): boolean; }
      declare const element: Element;
      element.checkVisibility();
      interface Set<T> { union(other: Set<T>): Set<T>; }
      declare const values: Set<number>;
      values.union(values);
    `,
    expected: [],
  },
  {
    name: "namespaced native names and their subclasses",
    code: `
      namespace Local {
        export class Element { checkVisibility() { return true; } }
        export class Locale { getCalendars() { return ["custom"]; } }
      }
      new Local.Element().checkVisibility();
      new Local.Locale().getCalendars();
      class CustomElement extends Local.Element {}
      new CustomElement().checkVisibility();
      function constrained<T extends Local.Element>(element: T) {
        element.checkVisibility();
      }
    `,
    expected: [],
  },
  {
    name: "imported names from a file named like a default library",
    code: `
      import { Element, Set } from "./lib.dom";
      new Element().checkVisibility();
      new Set<number>().union(new Set<number>());
    `,
    files: {
      "lib.dom.d.ts": `
        export class Element { checkVisibility(): boolean; }
        export class Set<T> { union(other: Set<T>): Set<T>; }
      `,
    },
    expected: [],
  },
  {
    name: "native aliases, subclasses, generics and primitive receivers",
    code: `
      type NativeElement = Element;
      declare const element: NativeElement;
      element.checkVisibility();
      class CustomElement<T> extends HTMLElement { marker?: T; }
      declare const custom: CustomElement<string>;
      custom.checkVisibility();
      class CustomSet<T> extends Set<T> {}
      declare const values: CustomSet<number>;
      values.union(new Set<number>());
      function constrained<T extends Set<number>>(value: T) { value.union(value); }
      "text".isWellFormed();
      new Intl.Locale("en").getCalendars();
    `,
    expected: [
      "check-visibility",
      "check-visibility",
      "set-methods",
      "set-methods",
      "string-wellformed",
      "intl-locale-info",
    ],
  },
  {
    name: "native interfaces merged with global augmentations",
    code: `
      declare global {
        interface Element { customMarker?: string; }
        interface Set<T> { customMarker?: T; }
      }
      declare const element: Element;
      element.checkVisibility();
      declare const values: Set<number>;
      values.union(values);
    `,
    expected: ["check-visibility", "set-methods"],
  },
  {
    name: "a compiler-selected DOM library replacement",
    code: `
      declare const element: Element;
      element.checkVisibility();
    `,
    files: {
      "node_modules/@typescript/lib-dom/package.json": JSON.stringify({
        name: "@typescript/lib-dom",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      "node_modules/@typescript/lib-dom/index.d.ts": `
        interface Element { checkVisibility(): boolean; }
      `,
    },
    defaultLibraryPath: "node_modules/@typescript/lib-dom/index.d.ts",
    expected: ["check-visibility"],
  },
];

describe("typed receiver declaration identity", () => {
  it.each(fixtures)(
    "handles $name",
    async ({ code, files, defaultLibraryPath, expected }) => {
      const fixture = await createTypedFixture(code, {
        target: "ESNext",
        libReplacement: defaultLibraryPath ? true : undefined,
      });
      try {
        for (const [path, contents] of Object.entries(files ?? {})) {
          const fullPath = join(fixture.root, path);
          await fs.mkdir(dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, contents);
        }
        const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
        if (defaultLibraryPath) {
          const library = program.getSourceFile(
            await fs.realpath(join(fixture.root, defaultLibraryPath)),
          );
          expect(library).toBeDefined();
          expect(library && program.isSourceFileDefaultLibrary(library)).toBe(true);
        }
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
        ).toEqual([]);

        const messages = await lintTypedFixture(fixture, {
          available: reportingPolicyFor(...webFeatures, ...jsFeatures),
          includeWebApis: { preset: "type-aware", only: webFeatures },
          includeJsBuiltins: { preset: "type-aware", only: jsFeatures },
        });
        expect(messages.some((message) => message.fatal)).toBe(false);
        expect(
          messages
            .filter((message) => message.ruleId === "baseline-js/use-baseline")
            .map((message) => message.message.match(/\(([^)]+)\)\.$/)?.[1]),
        ).toEqual(expected);
      } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
      }
    },
    15000,
  );
});
