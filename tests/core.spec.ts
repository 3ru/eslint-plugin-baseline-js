import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

describe("orchestrator (ESLint core delegates)", () => {
  it("[with] widely: 'with' (limited) should be flagged", async () => {
    const msgs = await lintWithBaseline("with ({} ) {}", "widely");
    expect(msgs.some((m) => m.includes("'with' is not Baseline Widely available (with)."))).toBe(
      true,
    );
  });

  it("[arguments-callee] widely: arguments.callee (limited) should be flagged", async () => {
    const msgs = await lintWithBaseline("function f(){ return arguments.callee }", "widely");
    expect(
      msgs.some((m) =>
        m.includes("'arguments.callee' is not Baseline Widely available (arguments-callee)."),
      ),
    ).toBe(true);
  });

  it("[escape-unescape] widely: escape() (limited) should be flagged", async () => {
    const msgs = await lintWithBaseline('escape("x")', "widely");
    expect(
      msgs.some((m) => m.includes("'escape' is not Baseline Widely available (escape-unescape).")),
    ).toBe(true);
  });

  it("[date-get-year-set-year] widely: Date#getYear / setYear (limited) should be flagged", async () => {
    const msgs1 = await lintWithBaseline("(new Date()).getYear()", "widely");
    const msgs2 = await lintWithBaseline("(new Date()).setYear(99)", "widely");
    expect(
      msgs1.some((m) =>
        m.includes("'getYear' on Date is not Baseline Widely available (date-get-year-set-year)."),
      ),
    ).toBe(true);
    expect(
      msgs2.some((m) =>
        m.includes("'setYear' on Date is not Baseline Widely available (date-get-year-set-year)."),
      ),
    ).toBe(true);
  });
});
