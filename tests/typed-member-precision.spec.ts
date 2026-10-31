import { promises as fs } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { CommonRuleOptions } from "../src/config";
import { lintWithBaseline } from "./helpers";
import { reportingPolicyFor } from "./utils/policy";
import { createTypedFixture, lintTypedFixture } from "./utils/typed-fixture";

async function lint(code: string, options: CommonRuleOptions) {
  const fixture = await createTypedFixture(code, { target: "ESNext" });
  try {
    const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    ).toEqual([]);
    const messages = await lintTypedFixture(fixture, options);
    expect(messages.some((message) => message.fatal)).toBe(false);
    return messages;
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

describe("typed member compatibility ownership", () => {
  it("uses the concrete Range and StaticRange histories for inherited fields", async () => {
    const code = [
      "declare const range: Range;",
      "declare const staticRange: StaticRange;",
      ...["collapsed", "startContainer", "startOffset", "endContainer", "endOffset"].flatMap(
        (member) => [`range.${member};`, `staticRange.${member};`],
      ),
    ].join("\n");
    expect(
      await lint(code, {
        available: 2020,
        includeWebApis: { preset: "type-aware", only: ["selection-api"] },
      }),
    ).toEqual([]);
  });

  it("reports the exact owner and year before and after the StaticRange boundary", async () => {
    const code =
      "declare const range: Range;\ndeclare const staticRange: StaticRange;\ndeclare const abstractRange: AbstractRange;\nrange.collapsed;\nstaticRange.collapsed;\nabstractRange.collapsed;";
    const messages = await lint(code, {
      available: 2019,
      includeWebApis: { preset: "type-aware", only: ["selection-api"] },
    });
    expect(messages).toHaveLength(2);
    expect(messages).toMatchObject([
      {
        message:
          "The 'collapsed' member of StaticRange instances does not meet your Baseline 2019 target. Its Baseline year is 2020. Feature ID: selection-api.",
        line: 5,
        column: 13,
        endLine: 5,
        endColumn: 22,
      },
      {
        message:
          "The 'collapsed' member of AbstractRange instances does not meet your Baseline 2019 target. Its Baseline year is 2021. Feature ID: selection-api.",
        line: 6,
        column: 15,
        endLine: 6,
        endColumn: 24,
      },
    ]);
  });

  it("preserves exact ownership through aliases, inheritance and constraints", async () => {
    expect(
      await lint(
        `
      type Alias = Range;
      declare const alias: Alias;
      alias.collapsed;
      interface CustomRange extends Range {}
      declare const custom: CustomRange;
      custom.collapsed;
      class DerivedRange extends Range {}
      new DerivedRange().collapsed;
      function constrained<T extends Range>(range: T) { range.collapsed; }
    `,
        {
          available: 2020,
          includeWebApis: { preset: "type-aware", only: ["selection-api"] },
        },
      ),
    ).toEqual([]);
  });

  it("resolves each union branch before applying the target", async () => {
    const messages = await lint(
      `
      declare const concrete: Range | StaticRange;
      concrete.collapsed;
      declare const abstract: Range | AbstractRange;
      abstract.collapsed;
    `,
      {
        available: 2020,
        includeWebApis: { preset: "type-aware", only: ["selection-api"] },
      },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe(
      "The 'collapsed' member of AbstractRange instances does not meet your Baseline 2020 target. Its Baseline year is 2021. Feature ID: selection-api.",
    );
    expect(messages[0].line).toBe(5);
  });

  it("rejects own overrides and conflicting intersections while keeping inherited members", async () => {
    const messages = await lint(
      `
      class CustomElement extends HTMLElement { checkVisibility() { return true; } }
      declare const element: CustomElement;
      element.checkVisibility();
      element.getRootNode();
      declare const conflicting: Element & { checkVisibility(): boolean };
      conflicting.checkVisibility();
      declare const harmless: Element & { marker: true };
      harmless.checkVisibility();
    `,
      {
        available: reportingPolicyFor("check-visibility", "shadow-dom"),
        includeWebApis: { preset: "type-aware", only: ["check-visibility", "shadow-dom"] },
      },
    );
    expect(
      messages.map((message) => [
        message.line,
        message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
      ]),
    ).toEqual([
      [5, "shadow-dom"],
      [9, "check-visibility"],
    ]);
  });

  it("retains native members with compatible merged declarations", async () => {
    const messages = await lint(
      `
      declare global { interface Element { checkVisibility(options?: CheckVisibilityOptions): boolean; } }
      declare const element: Element;
      element.checkVisibility();
    `,
      {
        available: reportingPolicyFor("check-visibility"),
        includeWebApis: { preset: "type-aware", only: ["check-visibility"] },
      },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("Feature ID: check-visibility.");
  });

  it("retains native overloads and narrowed inherited properties", async () => {
    const messages = await lint(
      "declare var anchor: HTMLAnchorElement;\nanchor.addEventListener;\ndeclare var data: CDATASection;\ndata.ownerDocument;\ndata.textContent;",
      {
        available: 0,
        includeWebApis: { preset: "type-aware", only: ["events", "dom"] },
      },
    );
    expect(
      messages.map((message) => [
        message.line,
        message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
      ]),
    ).toEqual([
      [2, "events"],
      [4, "dom"],
      [5, "dom"],
    ]);
  });

  it("detects native iterator methods independently of the Iterator.from call", async () => {
    const messages = await lint(
      "var iterator = Iterator.from([1, 2]);\niterator.map(value => value + 1);\n[1, 2].values().map(value => value + 1);",
      {
        available: reportingPolicyFor("iterator-methods"),
        includeJsBuiltins: { preset: "type-aware", only: ["iterator-methods"] },
      },
    );
    expect(messages.map((message) => message.line)).toEqual([1, 2, 3]);
    expect(
      messages
        .slice(1)
        .every((message) => message.message.startsWith("The 'map' member of Iterator instances")),
    ).toBe(true);
  });

  it("uses closer native histories without falling back to excluded or ignored ancestors", async () => {
    const code =
      "declare var script: HTMLScriptElement;\nscript.textContent;\ndeclare var link: SVGAElement;\nlink.className;";
    const options: CommonRuleOptions = {
      available: 0,
      includeWebApis: { preset: "type-aware", only: ["dom", "script", "svg-discouraged"] },
    };
    const messages = await lint(code, options);
    expect(
      messages.map((message) => [
        message.line,
        message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
      ]),
    ).toEqual([
      [2, "script"],
      [4, "svg-discouraged"],
    ]);
    expect(messages[0].message).toContain(
      "The 'textContent' member of HTMLScriptElement instances",
    );
    expect(messages[1].message).toContain("The 'className' member of SVGElement instances");
    expect(
      await lint(code, { ...options, includeWebApis: { preset: "type-aware", only: ["dom"] } }),
    ).toEqual([]);
    expect(await lint(code, { ...options, ignoreFeatures: ["script", "svg-discouraged"] })).toEqual(
      [],
    );
  });
});

describe("argument pattern receiver ownership", () => {
  const features = ["canvas-2d-alpha", "ext-srgb"];
  const options: CommonRuleOptions = {
    available: reportingPolicyFor(...features),
    includeWebApis: { preset: "type-aware", only: features },
  };

  it("preserves native Canvas and WebGL call forms and ranges", async () => {
    const code = [
      "const canvas = document.createElement('canvas');",
      "canvas.getContext('2d', { alpha: true });",
      "canvas['getContext']('2d', { ['alpha']: false });",
      "declare const optional: HTMLCanvasElement | null;",
      "optional?.getContext?.('2d', { alpha: true });",
      "declare const gl: WebGLRenderingContext;",
      "gl.getExtension('EXT_sRGB');",
      "gl.getSupportedExtensions()?.includes('EXT_sRGB');",
      "declare const gl2: WebGL2RenderingContext;",
      "gl2['getExtension']?.('EXT_sRGB');",
      "gl2['getSupportedExtensions']()?.['includes']('EXT_sRGB');",
    ].join("\n");
    const messages = await lint(code, options);
    expect(messages.map((message) => message.line)).toEqual([2, 3, 5, 7, 8, 10, 11]);
    expect(messages.map((message) => message.message.match(/Feature ID: ([\w-]+)\./)?.[1])).toEqual(
      [
        "canvas-2d-alpha",
        "canvas-2d-alpha",
        "canvas-2d-alpha",
        "ext-srgb",
        "ext-srgb",
        "ext-srgb",
        "ext-srgb",
      ],
    );
    expect(messages[0]).toMatchObject({ column: 1, endColumn: 41, endLine: 2 });
  });

  it("rejects custom, uncertain, overridden and wrong native receivers", async () => {
    expect(
      await lint(
        `
      const custom = {
        getContext(mode: string, options: object) { return { mode, options }; },
        getExtension(name: string) { return name; },
        getSupportedExtensions() { return ["EXT_sRGB"]; },
      };
      custom.getContext('2d', { alpha: true });
      custom.getExtension('EXT_sRGB');
      custom.getSupportedExtensions().includes('EXT_sRGB');
      declare const mixed: HTMLCanvasElement | typeof custom;
      mixed.getContext('2d', { alpha: true });
      declare const anyValue: any;
      anyValue.getContext('2d', { alpha: true });
      declare const offscreen: OffscreenCanvas;
      offscreen.getContext('2d', { alpha: true });
      class CustomCanvas extends HTMLCanvasElement { getContext(_contextId: string, _options?: unknown) { return null; } }
      new CustomCanvas().getContext('2d', { alpha: true });
    `,
        options,
      ),
    ).toEqual([]);
  });

  it.each([true, { preset: "safe" }, { preset: "type-aware" }] as const)(
    "abstains without type services under %j",
    async (includeWebApis) => {
      const messages = await lintWithBaseline(
        "object.getContext('2d', { alpha: true }); object.getExtension('EXT_sRGB'); object.getSupportedExtensions().includes('EXT_sRGB');",
        reportingPolicyFor(...features),
        {},
        { includeWebApis, includeJsBuiltins: false },
      );
      expect(messages).toEqual([]);
    },
  );

  it("keeps Web safe checks independent of typed JavaScript settings", async () => {
    expect(
      await lint(
        "declare const canvas: HTMLCanvasElement; canvas.getContext('2d', { alpha: true });",
        {
          ...options,
          includeWebApis: { preset: "safe", only: features },
          includeJsBuiltins: { preset: "type-aware" },
        },
      ),
    ).toEqual([]);
  });
});
