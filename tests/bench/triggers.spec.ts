import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ROOT, TMP_DIR, TRIGGERS_FILE } from "../../scripts/bench/lib.mts";
import { classify, decide, loadTriggers } from "../../scripts/bench/triggers.mts";

const triggers = loadTriggers(TRIGGERS_FILE);
const CHANGED = join(ROOT, "scripts", "bench", "changed.mts");

describe("classify against bench/perf-triggers.json", () => {
  it("ignores documentation, tests and workflows other than perf.yml", () => {
    expect(classify("docs/BENCHMARKS.md", triggers)).toBeNull();
    expect(classify("tests/core.spec.ts", triggers)).toBeNull();
    expect(classify(".github/workflows/ci.yml", triggers)).toBeNull();
    expect(classify("README.md", triggers)).toBeNull();
  });

  it("treats source changes as code", () => {
    expect(classify("src/index.ts", triggers)).toBe("code or build input");
  });

  it("lets alwaysRun beat every ignore rule", () => {
    expect(classify(".github/workflows/perf.yml", triggers)).toBe(
      "always runs for .github/workflows/perf.yml",
    );
    expect(classify("bench/notes.md", triggers)).toBe("always runs for bench/");
    expect(classify("scripts/bench/report.mts", triggers)).toBe("always runs for scripts/bench/");
  });

  it("ignores the files in ignoreFiles", () => {
    expect(classify("vitest.config.ts", triggers)).toBeNull();
    expect(classify("LICENSE", triggers)).toBeNull();
  });

  it("matches extensions without regard to case, and normalises Windows separators", () => {
    expect(classify("src/Diagram.PNG", triggers)).toBeNull();
    expect(classify("src/NOTES.MD", triggers)).toBeNull();
    expect(classify("docs\\guide.md", triggers)).toBeNull();
    expect(classify("./src/index.ts", triggers)).toBe("code or build input");
  });
});

describe("decide", () => {
  it("does not run for a docs-only change", () => {
    const decision = decide(["docs/a.md", ".github/workflows/ci.yml"], triggers);
    expect(decision).toEqual({
      run: false,
      reason: "all 2 changed files are documentation, tests or other ignored paths",
      triggering: [],
    });
  });

  it("runs for a source change and names the triggering files", () => {
    const decision = decide(["docs/a.md", "src/index.ts"], triggers);
    expect(decision.run).toBe(true);
    expect(decision.reason).toBe(
      "1 of 2 changed files affects the rule or its build (first: src/index.ts)",
    );
    expect(decision.triggering).toEqual([{ file: "src/index.ts", why: "code or build input" }]);
  });

  it("names at most five files in the reason", () => {
    const files = Array.from({ length: 7 }, (_, i) => `src/f${i}.ts`);
    const { reason } = decide(files, triggers);
    expect(reason).toBe(
      "7 of 7 changed files affect the rule or its build (first: src/f0.ts, src/f1.ts, src/f2.ts, src/f3.ts, src/f4.ts, …)",
    );
  });

  it("explains an empty change set and a single ignored file", () => {
    expect(decide([], triggers).reason).toBe("no changed files");
    expect(decide(["CHANGELOG.md"], triggers).reason).toBe(
      "the only changed file is documentation, a test or another ignored path",
    );
  });
});

describe("loadTriggers", () => {
  it("rejects a rules file whose lists are not string arrays", () => {
    const dir = join(TMP_DIR, "triggers-spec");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "bad.json");
    writeFileSync(
      file,
      JSON.stringify({
        ignoreDirectories: "docs/",
        ignoreExtensions: [],
        ignoreFiles: [],
        alwaysRun: [],
      }),
    );
    expect(() => loadTriggers(file)).toThrow(/ignoreDirectories/);
  });
});

describe("changed.mts", () => {
  it("can be imported without running the command line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const module = await import("../../scripts/bench/changed.mts");
    expect(module.main).toBeInstanceOf(Function);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("exits 2 with the usage when neither --base nor --files is given", () => {
    const result = spawnSync(process.execPath, [CHANGED], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("give --base or --files");
    expect(result.stderr).toContain("usage: pnpm bench:changed [options]");
  });

  it("prints the decision for --files", () => {
    const result = spawnSync(process.execPath, [CHANGED, "--files", "src/index.ts,docs/a.md"], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n").slice(0, 3)).toEqual([
      "run=true",
      "1 of 2 changed files affects the rule or its build (first: src/index.ts)",
      "  src/index.ts  (code or build input)",
    ]);
  });
});
