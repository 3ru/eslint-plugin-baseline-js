import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

describe("ignore pattern configuration errors", () => {
  it.each(["ignoreFeatures", "ignoreNodeTypes"])(
    "identifies the invalid pattern in %s",
    async (option) => {
      await expect(
        lintWithBaseline("const value = 1;", "widely", {}, { [option]: ["/[/"] }),
      ).rejects.toMatchObject({
        name: "SyntaxError",
        message: expect.stringContaining(`Invalid ${option} pattern "/[/".`),
      });
    },
  );

  it("keeps strings without slash delimiters as literal matches", async () => {
    await expect(
      lintWithBaseline(
        "const value = 1;",
        "widely",
        {},
        {
          ignoreFeatures: ["["],
          ignoreNodeTypes: ["["],
        },
      ),
    ).resolves.toEqual([]);
  });
});
