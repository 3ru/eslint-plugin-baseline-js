import type { Rule } from "eslint";
import { describe, expect, it, vi } from "vitest";
import { mergeRuleListeners } from "../../src/utils/listeners";

describe("mergeRuleListeners", () => {
  it("adds handlers for events that do not yet exist", () => {
    const target: Rule.RuleListener = {};
    const handler = vi.fn();

    const result = mergeRuleListeners(target, { ExpressionStatement: handler });

    expect(result).toBe(target);
    result.ExpressionStatement?.({} as never);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("preserves execution order when merging multiple handlers", () => {
    const calls: string[] = [];

    const initial: Rule.RuleListener = {
      CallExpression() {
        calls.push("first");
      },
    };

    mergeRuleListeners(
      initial,
      {
        CallExpression() {
          calls.push("second");
        },
      },
      {
        CallExpression() {
          calls.push("third");
        },
      },
    );

    initial.CallExpression?.({} as never);
    expect(calls).toEqual(["first", "second", "third"]);
  });

  it("forwards original call context and arguments", () => {
    const target: Rule.RuleListener = {};
    const base = vi.fn(function (this: { tag: string }, node: Rule.Node, ...rest: unknown[]) {
      expect(this.tag).toBe("ctx");
      expect((node as { type: string }).type).toBe("Identifier");
      expect(rest[0]).toBe("flag");
    });
    (target as Record<string, unknown>).Identifier =
      base as unknown as Rule.RuleListener["Identifier"];

    const spy = vi.fn(function (this: { tag: string }, node: Rule.Node, ...rest: unknown[]) {
      expect(this.tag).toBe("ctx");
      expect((node as { type: string }).type).toBe("Identifier");
      expect(rest[0]).toBe("flag");
    });

    mergeRuleListeners(target, {
      Identifier: spy as unknown as Rule.RuleListener["Identifier"],
    });

    const context = { tag: "ctx" };
    const handler = target.Identifier as unknown as (
      this: { tag: string },
      node: Rule.Node,
      ...rest: unknown[]
    ) => void;
    handler.call(context, { type: "Identifier" } as never, "flag");

    expect(base).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledOnce();
  });
});
