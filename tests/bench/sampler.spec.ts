import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { countNodes, parseSource, walk } from "../../scripts/bench/ast.mts";
import { timingRuleOptions } from "../../scripts/bench/descriptors.mts";
import { createBenchESLint } from "../../scripts/bench/eslint-setup.mjs";
import {
  canonicalJson,
  createRng,
  createSampler,
  drawCount,
  readJsonFile,
} from "../../scripts/bench/lib.mts";

describe("createRng", () => {
  it("repeats the same stream for the same seed", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    const c = createRng("other");
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(first);

    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("refuses to pick from nothing or draw below one", () => {
    const rng = createRng("x");
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(rng.pick(["only"])).toBe("only");
  });
});

describe("createSampler", () => {
  const entries: Array<readonly [string, number]> = [
    ["a", 1],
    ["b", 3],
    ["never", 0],
    ["c", 6],
  ];

  it("is deterministic for a seed", () => {
    const sample = createSampler(entries);

    const draw = (seed: string) => {
      const rng = createRng(seed);

      return Array.from({ length: 100 }, () => sample(rng));
    };

    expect(draw("s")).toEqual(draw("s"));
    expect(draw("s")).not.toEqual(draw("t"));
  });

  it("draws in proportion to the weights and never draws a zero weight", () => {
    const sample = createSampler(entries);
    const rng = createRng("frequencies");
    const counts = new Map<string, number>();
    const draws = 100_000;

    for (let i = 0; i < draws; i++) {
      const item = sample(rng);
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }

    expect(counts.has("never")).toBe(false);

    for (const [item, weight] of entries) {
      expect(Math.abs((counts.get(item) ?? 0) / draws - weight / 10)).toBeLessThan(0.01);
    }
  });

  it("throws on an empty pool, a zero total or a bad weight", () => {
    expect(() => createSampler([])).toThrow(RangeError);
    expect(() => createSampler([["a", 0]])).toThrow(RangeError);
    expect(() => createSampler([["a", -1]])).toThrow(RangeError);
    expect(() => createSampler([["a", Number.NaN]])).toThrow(RangeError);
  });
});

describe("drawCount", () => {
  it("is unbiased: the mean of 100k draws is within 1% of the expectation", () => {
    const rng = createRng("draw-count");

    for (const expected of [2.37, 12.5]) {
      let sum = 0;

      for (let i = 0; i < 100_000; i++) {
        const count = drawCount(rng, expected);
        expect(count === Math.floor(expected) || count === Math.floor(expected) + 1).toBe(true);
        sum += count;
      }

      expect(Math.abs(sum / 100_000 - expected) / expected).toBeLessThan(0.01);
    }
  });

  it("rejects a negative or non-finite expectation", () => {
    const rng = createRng("x");
    expect(() => drawCount(rng, -0.5)).toThrow(RangeError);
    expect(() => drawCount(rng, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("readJsonFile", () => {
  const VersionSchema = z.object({ version: z.literal(2, { error: "regenerate the file" }) });

  const fileWith = (text: string): string => {
    const file = join(mkdtempSync(join(tmpdir(), "bench-lib-")), "data.json");
    writeFileSync(file, text);

    return file;
  };

  it("returns what the schema parses", () => {
    expect(readJsonFile(fileWith('{"version":2,"extra":1}'), VersionSchema)).toEqual({
      version: 2,
    });
  });

  it("names the file and keeps the schema's message and the error as cause", () => {
    const file = fileWith('{"version":1}');

    expect(() => readJsonFile(file, VersionSchema)).toThrow(`${file}: `);
    expect(() => readJsonFile(file, VersionSchema)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("regenerate the file"),
        cause: expect.any(z.ZodError),
      }),
    );
  });

  it("names the file on malformed JSON", () => {
    const file = fileWith("{");
    expect(() => readJsonFile(file, VersionSchema)).toThrow(`${file}: SyntaxError`);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: [{ z: 1, a: null }], a: "x" })).toBe(
      '{"a":"x","b":[{"a":null,"z":1}]}',
    );
  });
});

describe("countNodes", () => {
  const samples = {
    "sample.js": `
import { a } from "./a.js";
export default class Box extends Base {
  #secret = 1;
  static count = 0;
  constructor(value) { super(); this.value = value ?? a?.b; }
  get size() { return [...this.items].length; }
  async *each() { for await (const item of this.items) yield item; }
}
const tag = String.raw\`x\${1 + 2}y\`;
const re = /a+b/giu;
label: for (let i = 0; i < 3; i++) { if (i) continue label; else break; }
try { throw new Error("x", { cause: 1 }); } catch { /* ignored */ } finally { void 0; }
const { x = 1, ...rest } = { x: 2, y: 3 };
switch (rest.y) { case 3: break; default: }
const fn = async (p, q = 2) => (await p) ** q;
`,
    "sample.ts": `
enum Color { Red, Green = 2 }
namespace NS { export const v: number = 1; }
interface Shape<T extends object = {}> {
  readonly area: number;
  method?(x: T): void;
  [key: string]: unknown;
}
type Union = "a" | \`b\${string}\` | keyof Shape;
abstract class Base<T> implements Shape {
  declare area: number;
  abstract go(): T;
  constructor(private readonly id: string) {}
}
@decorate class Decorated { @field accessor value = 1; }
function overload(x: string): string;
function overload(x: number): number;
function overload(x: any) { return x as never; }
const satisfied = { a: 1 } satisfies Record<string, number>;
const element = document.querySelector("a")!;
export type { Union };
declare global { interface Window { extra: string } }
const tuple: [a: number, b?: string, ...rest: boolean[]] = [1];
function assertIsString(v: unknown): asserts v is string {}
`,
    "sample.tsx": `
import type { FC } from "react";
const Item = <T,>({ value }: { value: T }) => <li key={String(value)}>{value as any}</li>;
export const List: FC<{ items: string[] }> = ({ items }) => (
  <>
    <ul className="list" {...{ id: "x" }}>
      {items.map((item) => <Item value={item} />)}
    </ul>
    <input disabled value={\`v-\${items.length}\`} />
    <svg:rect xlink:href="#a" />
    <Foo.Bar.Baz />
    text &amp; more
  </>
);
`,
  };

  async function eslintNodeTypes(filePath: string, source: string): Promise<string[]> {
    const types: string[] = [];

    const eslint = createBenchESLint({
      cwd: import.meta.dirname,
      plugin: {
        meta: { name: "stub" },
        rules: { "use-baseline": { meta: { schema: false }, create: () => ({}) } },
      },
      ruleOptions: timingRuleOptions(),
      typed: false,
      tsconfig: null,
      stats: false,
      extraPlugins: {
        bench: {
          rules: {
            "node-types": {
              meta: { schema: [] },
              create: () => ({
                "*": (node: { type: string }) => {
                  types.push(node.type);
                },
              }),
            },
          },
        },
      },
      extraRules: { "bench/node-types": "error" },
    });

    const [result] = await eslint.lintText(source, { filePath });
    expect(result?.messages.filter((message) => message.fatal)).toEqual([]);

    return types;
  }

  for (const [filePath, source] of Object.entries(samples)) {
    it(`equals ESLint's "*" count and order on ${filePath}`, async () => {
      const expected = await eslintNodeTypes(filePath, source);
      const ast = parseSource(source, filePath);
      const visited: string[] = [];
      walk(ast, (node, parent) => {
        expect(parent === null).toBe(node === ast);
        visited.push(node.type);
      });
      expect(expected.length).toBeGreaterThan(50);
      expect(countNodes(ast)).toBe(expected.length);
      expect(visited).toEqual(expected);
    });
  }
});
