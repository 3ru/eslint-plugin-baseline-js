import { promises as fs } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import apiDescriptors from "../src/baseline/data/descriptors.api";
import type { CallMemberWithArgsDescriptor } from "../src/baseline/types";
import { reportingPolicyFor } from "./utils/policy";
import { createTypedFixture, lintTypedFixture } from "./utils/typed-fixture";

const descriptors = apiDescriptors.filter(
  (descriptor): descriptor is CallMemberWithArgsDescriptor & { compatKey: string } =>
    descriptor.kind === "callMemberWithArgs",
);

const forms = ["dot", "computed", "optional", "parenthesized"] as const;

function callFor(
  descriptor: CallMemberWithArgsDescriptor,
  receiver: string,
  form: (typeof forms)[number],
) {
  const args: string[] = [];
  if (descriptor.stringArg) {
    args[descriptor.stringArg.index] = JSON.stringify(descriptor.stringArg.values[0]);
  }
  if (descriptor.objectArg) {
    const entries = [
      ...(descriptor.objectArg.hasKeys ?? []).map((key) => [key, true]),
      ...(descriptor.objectArg.knownDefinedKeys ?? []).map((key) => [key, 16]),
      ...(descriptor.objectArg.keyValues ?? []).map(({ key, values }) => [
        key,
        values?.[0] ?? true,
      ]),
    ];
    args[descriptor.objectArg.index] = `{ ${entries
      .map(
        ([key, value]) =>
          `${form === "dot" ? JSON.stringify(key) : `[${JSON.stringify(key)}]`}: ${JSON.stringify(value)}`,
      )
      .join(", ")} }`;
  }
  const member = (base: string, prop: string, nullable = false) => {
    const optional = nullable || form === "optional" || form === "parenthesized";
    const access =
      form === "dot"
        ? `${base}${optional ? "?." : "."}${prop}`
        : `${base}${optional ? "?." : ""}[${JSON.stringify(prop)}]`;
    return form === "parenthesized" ? `(${access})` : access;
  };
  const base = descriptor.viaCall ? `${member(receiver, descriptor.viaCall.prop)}()` : receiver;
  const callee = member(base, descriptor.prop, !!descriptor.viaCall);
  return `${callee}${form === "optional" || form === "parenthesized" ? "?." : ""}(${Array.from(
    { length: args.length },
    (_, index) => args[index] ?? "null",
  ).join(", ")});`;
}

describe("typed argument descriptor corpus", () => {
  it.each([true, false])(
    "checks every call pattern with a native receiver = %s",
    async (native) => {
      expect(descriptors.length).toBeGreaterThan(0);
      const lines = [
        "var custom = { getContext(_mode: string, _options: object) {}, getExtension(_name: string) {}, getSupportedExtensions(): string[] { return []; } };",
      ];
      const expected: Array<{ line: number; featureId: string }> = [];
      for (const [index, descriptor] of descriptors.entries()) {
        const receiver = native ? `receiver${index}` : "custom";
        if (native) lines.push(`declare var ${receiver}: ${descriptor.iface};`);
        for (const form of forms) {
          lines.push(callFor(descriptor, receiver, form));
          if (native) expected.push({ line: lines.length, featureId: descriptor.featureId });
        }
      }
      const fixture = await createTypedFixture(lines.join("\n"), { target: "ESNext" });
      try {
        const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
        ).toEqual([]);
        const features = [...new Set(descriptors.map((descriptor) => descriptor.featureId))];
        const messages = await lintTypedFixture(fixture, {
          available: reportingPolicyFor(...features),
          includeWebApis: { preset: "type-aware", only: features },
        });
        expect(messages.some((message) => message.fatal)).toBe(false);
        expect(
          messages.map((message) => ({
            line: message.line,
            featureId: message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
          })),
        ).toEqual(expected);
      } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
      }
    },
  );
});
