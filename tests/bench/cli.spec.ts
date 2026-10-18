import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CliError,
  numberList,
  type Options,
  option,
  parseCli,
  parseOptions,
} from "../../scripts/bench/cli.mts";

const specs = {
  scale: option.number(3),
  typedIterations: option.number(2),
  typed: option.flag(true),
  failOnRegression: option.flag(false),
  out: option.text(""),
  only: option.list(),
};

describe("parseOptions", () => {
  it("returns the defaults, with fresh arrays, when no flag is given", () => {
    const options = parseOptions([], specs);
    expect(options).toEqual({
      scale: 3,
      typedIterations: 2,
      typed: true,
      failOnRegression: false,
      out: "",
      only: [],
    });
    expect(options.only).not.toBe(specs.only.default);
    expect(parseOptions([], { only: option.list(["a"]) }).only).toEqual(["a"]);
  });

  it("maps kebab-case flags to camelCase keys", () => {
    const options = parseOptions(["--typed-iterations", "5", "--fail-on-regression"], specs);
    expect(options.typedIterations).toBe(5);
    expect(options.failOnRegression).toBe(true);
    expect(() => parseOptions(["--typedIterations", "5"], specs)).toThrow(CliError);
  });

  it("parses finite numbers and rejects anything else", () => {
    expect(parseOptions(["--scale", "0.5"], specs).scale).toBe(0.5);
    expect(parseOptions(["--scale=1e3"], specs).scale).toBe(1000);
    expect(() => parseOptions(["--scale", "abc"], specs)).toThrow(CliError);
    expect(() => parseOptions(["--scale="], specs)).toThrow(CliError);
    expect(() => parseOptions(["--scale", "Infinity"], specs)).toThrow(CliError);
    expect(() => parseOptions(["--scale"], specs)).toThrow(CliError);
  });

  it("negates booleans with --no-x and rejects --x=false", () => {
    expect(parseOptions(["--no-typed"], specs).typed).toBe(false);
    expect(parseOptions(["--typed"], { ...specs, typed: option.flag(false) }).typed).toBe(true);
    expect(() => parseOptions(["--typed=false"], specs)).toThrow(CliError);
  });

  it("collects repeats of array options and rejects repeated scalars", () => {
    expect(parseOptions(["--only", "a", "--only=b"], specs).only).toEqual(["a", "b"]);
    expect(() => parseOptions(["--scale", "1", "--scale", "2"], specs)).toThrow(
      /--scale given more than once/,
    );
    expect(() => parseOptions(["--typed", "--no-typed"], specs)).toThrow(CliError);
  });

  it("rejects unknown options and positionals", () => {
    expect(() => parseOptions(["--bogus"], specs)).toThrow(CliError);
    expect(() => parseOptions(["-x"], specs)).toThrow(CliError);
    expect(() => parseOptions(["main"], specs)).toThrow(CliError);
    expect(() => parseOptions(["--typed", "false"], specs)).toThrow(CliError);
  });

  it("keeps string values as given", () => {
    expect(parseOptions(["--out", "results/a.json"], specs).out).toBe("results/a.json");
    expect(parseOptions(["--out="], specs).out).toBe("");
  });
});

describe("numberList", () => {
  it("splits comma-separated positive numbers", () => {
    expect(numberList("scales", "1,4,16")).toEqual([1, 4, 16]);
    expect(numberList("scales", "0.5")).toEqual([0.5]);
  });

  it("reads an empty value as an empty list", () => {
    expect(numberList("typed-scales", "")).toEqual([]);
  });

  it("rejects empty entries, non-numbers and non-positive numbers", () => {
    expect(() => numberList("scales", "1,,2")).toThrow(CliError);
    expect(() => numberList("scales", "1,a")).toThrow(CliError);
    expect(() => numberList("scales", "0")).toThrow(/positive/);
    expect(() => numberList("scales", "-1")).toThrow(CliError);
  });
});

describe("parseCli", () => {
  class Exit extends Error {
    constructor(code: string | number | null | undefined) {
      super(`exit ${code}`);
    }
  }

  function capture() {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Exit(code);
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    return { exit, log, error };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the usage and exits 0 on --help and -h", () => {
    const { log } = capture();
    expect(() => parseCli(["--scale", "1", "--help"], specs, "usage: x")).toThrow("exit 0");
    expect(() => parseCli(["-h"], specs, "usage: x")).toThrow("exit 0");
    expect(log).toHaveBeenCalledWith("usage: x");
  });

  it("prints the error with the usage and exits 2 on bad input", () => {
    const { error } = capture();
    expect(() => parseCli(["--bogus"], specs, "usage: x")).toThrow("exit 2");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/bogus[\s\S]*\n\nusage: x$/));
  });

  it("exits 2 when refine rejects the options and returns what refine returns", () => {
    capture();

    const refine = (options: Options<typeof specs>) => ({
      scales: numberList("scales", options.out),
    });

    expect(() => parseCli(["--out", "1,x"], specs, "usage: x", refine)).toThrow("exit 2");
    expect(parseCli(["--out", "1,4"], specs, "usage: x", refine)).toEqual({ scales: [1, 4] });
  });

  it("lets errors other than CliError through", () => {
    capture();
    expect(() =>
      parseCli([], specs, "usage: x", () => {
        throw new TypeError("bug");
      }),
    ).toThrow(TypeError);
  });
});
