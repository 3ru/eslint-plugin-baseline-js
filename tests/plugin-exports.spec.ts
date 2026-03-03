import { describe, expect, it } from "vitest";
import plugin from "../src";

describe("plugin exports", () => {
  it("exposes documented configs", () => {
    expect(typeof plugin.configs.baseline).toBe("function");
    expect(typeof plugin.configs.recommended).toBe("function");
    expect(typeof plugin.configs["recommended-ts"]).toBe("function");
  });
});
