import { promises as fs } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { reportingPolicyFor } from "./utils/policy";
import { createTypedFixture, lintTypedFixture } from "./utils/typed-fixture";

const declarations =
  "interface HTMLElement { headingOffset: number; headingReset: boolean; id: string; }";
const usage =
  "declare const element: HTMLElement; element.headingOffset; element.headingReset; element.id;";

describe("typed Web API detection", () => {
  it.each([true, false])(
    "requires a standard-library member for heading offsets, library = %s",
    async (library) => {
      const source = library ? usage : `declare global { ${declarations} }\n${usage}`;
      const fixture = await createTypedFixture(source, { libReplacement: library });
      try {
        const libraryRoot = join(fixture.root, "node_modules/@typescript/lib-dom");
        if (library) {
          await fs.mkdir(libraryRoot, { recursive: true });
          await fs.writeFile(
            join(libraryRoot, "package.json"),
            JSON.stringify({ name: "@typescript/lib-dom", version: "1.0.0", types: "index.d.ts" }),
          );
          await fs.writeFile(join(libraryRoot, "index.d.ts"), declarations);
        }
        const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
        expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
        if (library) {
          const source = program.getSourceFile(await fs.realpath(join(libraryRoot, "index.d.ts")));
          expect(source && program.isSourceFileDefaultLibrary(source)).toBe(true);
        }
        const options = {
          available: reportingPolicyFor("heading-offset"),
          includeWebApis: { preset: "type-aware" as const, only: ["heading-offset"] },
        };
        const messages = await lintTypedFixture(fixture, options);
        expect(messages.some((message) => message.fatal)).toBe(false);
        expect(
          messages.map((message) => message.message.match(/Feature ID: ([\w-]+)\./)?.[1]),
        ).toEqual(library ? ["heading-offset", "heading-offset"] : []);
        expect(
          await lintTypedFixture(fixture, { ...options, ignoreFeatures: ["heading-offset"] }),
        ).toEqual([]);
      } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
      }
    },
  );
});
