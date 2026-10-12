import type { Rule } from "eslint";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import apiDescriptors from "../src/baseline/data/descriptors.api";
import builtinDescriptors from "../src/baseline/data/descriptors.jsbi";
import type { Descriptor } from "../src/baseline/types";
import { buildListeners } from "../src/rules/feature-usage/builder";

type SafeDescriptor = Exclude<Descriptor, { kind: "instanceMember" }>;
const roots = ["window", "globalThis", "self"];

function argumentsFor(descriptor: SafeDescriptor, computed = false): string {
  const args: string[] = [];
  if ("stringArg" in descriptor && descriptor.stringArg)
    args[descriptor.stringArg.index] = JSON.stringify(descriptor.stringArg.values[0]);
  if ("objectArg" in descriptor && descriptor.objectArg) {
    const options = descriptor.objectArg;
    const entries = [
      ...(options.hasKeys ?? []).map((key) => [key, "true"]),
      ...(options.keyValues ?? []).map(({ key, values }) => [
        key,
        JSON.stringify(values?.[0] ?? true),
      ]),
    ];
    args[options.index] = `{ ${entries
      .map(([key, value]) => `${computed ? `[${JSON.stringify(key)}]` : key}: ${value}`)
      .join(", ")} }`;
  }
  return Array.from({ length: args.length }, (_, index) => args[index] ?? "null").join(", ");
}

function casesFor(d: SafeDescriptor): { code: string; report: boolean }[] {
  const positive: string[] = [];
  const negative: string[] = [];
  const args = argumentsFor(d);
  if (d.kind === "callMemberWithArgs") {
    const receiver = d.viaCall ? `object.${d.viaCall.prop}()` : "object";
    positive.push(
      `${receiver}.${d.prop}(${args});`,
      `${receiver}[${JSON.stringify(d.prop)}](${argumentsFor(d, true)});`,
      `${receiver}?.[${JSON.stringify(d.prop)}]?.(${args});`,
    );
    if (d.viaCall)
      positive.push(
        `object[${JSON.stringify(d.viaCall.prop)}]()[${JSON.stringify(d.prop)}](${args});`,
      );
    negative.push(`${receiver}[${d.prop}](${args});`);
    if (d.viaCall) negative.push(`object[${d.viaCall.prop}]().${d.prop}(${args});`);
  } else if ("name" in d) {
    const invoke = (callee: string, options = args) =>
      `${d.kind === "callGlobal" ? "" : "new "}${callee}(${options});`;
    positive.push(invoke(d.name));
    for (const root of roots) {
      positive.push(
        invoke(`${root}.${d.name}`),
        invoke(`${root}[${JSON.stringify(d.name)}]`, argumentsFor(d, true)),
        invoke(`${root}.window[${JSON.stringify(d.name)}]`),
      );
      negative.push(`function shadow(${root}) { ${invoke(`${root}.${d.name}`)} }`);
    }
    positive.push(
      d.kind === "callGlobal"
        ? `${d.name}?.(${args});`
        : invoke(`(window?.[${JSON.stringify(d.name)}])`),
    );
    negative.push(
      `function shadow(${d.name}) { ${invoke(d.name)} }`,
      invoke(`window[${d.name}]`),
      invoke(`object.${d.name}`),
    );
  } else {
    const invoke = (receiver: string, computed = false) => {
      const member = `${receiver}${computed ? `[${JSON.stringify(d.prop)}]` : `.${d.prop}`}`;
      return `${d.kind === "newMember" ? "new " : ""}${member}${
        d.kind === "callStatic" || d.kind === "newMember" ? "()" : ""
      };`;
    };
    positive.push(invoke(d.base), invoke(d.base, true));
    for (const root of roots) {
      const receiver = d.base === "window" ? root : `${root}.${d.base}`;
      const computedReceiver = d.base === "window" ? root : `${root}[${JSON.stringify(d.base)}]`;
      positive.push(invoke(receiver), invoke(computedReceiver, true));
      negative.push(`function shadow(${root}) { ${invoke(receiver)} }`);
    }
    positive.push(
      d.kind === "newMember"
        ? `new (${d.base}?.[${JSON.stringify(d.prop)}])();`
        : `${d.base}?.[${JSON.stringify(d.prop)}]${d.kind === "callStatic" ? "?.()" : ""};`,
    );
    negative.push(
      `function shadow(${d.base}) { ${invoke(d.base)} }`,
      `${d.kind === "newMember" ? "new " : ""}${d.base}[dynamicKey]${
        d.kind === "callStatic" || d.kind === "newMember" ? "()" : ""
      };`,
      invoke(`object.${d.base}`),
    );
  }
  return [
    ...Array.from(new Set(positive), (code) => ({ code, report: true })),
    ...Array.from(new Set(negative), (code) => ({ code, report: false })),
  ];
}

// This corpus checks each bundled descriptor's AST shapes, not whether its
// source mapping is semantically correct or an API exists in a browser runtime.
// API mapping regressions and typed instance members have separate suites.
describe("safe descriptor AST corpus", () => {
  it.each([
    ["Web APIs", apiDescriptors],
    ["JavaScript builtins", builtinDescriptors],
  ] as const)(
    "covers global access and shadowing for %s",
    (_name, descriptors) => {
      const linter = new Linter();
      const safe = descriptors.filter(
        (d): d is SafeDescriptor => d.kind !== "instanceMember" && !d.typedOnly,
      );
      expect(safe.length).toBeGreaterThan(0);
      for (const descriptor of safe) {
        const cases = casesFor(descriptor);
        const rule: Rule.RuleModule = {
          meta: { schema: [] },
          create(context) {
            return buildListeners(context, {
              descriptors: [descriptor],
              report(node, d) {
                context.report({ node, message: d.featureId });
              },
            });
          },
        };
        const messages = linter.verify(cases.map(({ code }) => `{ ${code} }`).join("\n"), {
          languageOptions: { ecmaVersion: 2022, sourceType: "module" },
          plugins: { corpus: { rules: { detector: rule } } },
          rules: { "corpus/detector": "error" },
        });
        const expected = cases.flatMap(({ report }, index) =>
          report ? [{ line: index + 1, message: descriptor.featureId }] : [],
        );
        expect(
          messages.map(({ line, message }) => ({ line, message })),
          JSON.stringify(descriptor),
        ).toEqual(expected);
      }
    },
    10000,
  );
});
