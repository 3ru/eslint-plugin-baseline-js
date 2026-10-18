import { describe, expect, it } from "vitest";
import {
  classifyChange,
  holm,
  linearFit,
  mean,
  median,
  type PairedEstimate,
  pairedLogRatio,
  pooledWithinSd,
  quantile,
  stdev,
  tQuantile975,
} from "../../scripts/bench/stats.mts";

/** Exact two-sided sign-flip p by brute force, written independently of stats.mts. */
function referenceSignFlipP(d: readonly number[]): number {
  const observed = Math.abs(d.reduce((sum, x) => sum + x, 0));
  let extreme = 0;

  for (let mask = 0; mask < 2 ** d.length; mask++) {
    let sum = 0;

    for (const [i, x] of d.entries()) sum += (mask >> i) & 1 ? -x : x;

    if (Math.abs(sum) >= observed - 1e-12) extreme++;
  }

  return extreme / 2 ** d.length;
}

describe("descriptive statistics", () => {
  it("computes mean, sample SD, median and interpolated quantiles", () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(mean([])).toBeNaN();
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(stdev([1])).toBeNaN();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([5, 1], 1)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
    expect(() => quantile([1], 1.5)).toThrow(RangeError);
  });
});

describe("tQuantile975", () => {
  it("matches published critical values", () => {
    const known: Array<[number, number]> = [
      [1, 12.706],
      [2, 4.303],
      [5, 2.571],
      [10, 2.228],
      [30, 2.042],
      [60, 2.0],
      [1000, 1.962],
    ];

    for (const [df, t] of known) expect(tQuantile975(df)).toBeCloseTo(t, 3);
  });

  it("joins the table and the Cornish–Fisher expansion smoothly", () => {
    const values = [28, 29, 30, 31, 32, 40].map(tQuantile975);

    for (const [i, value] of values.slice(1).entries()) {
      expect(value).toBeLessThan(values[i] ?? Number.NaN);
    }

    expect(tQuantile975(31)).toBeCloseTo(2.039513446, 6);
    expect(tQuantile975(Number.POSITIVE_INFINITY)).toBeCloseTo(1.959964, 6);
  });

  it("has no value below one degree of freedom and rejects fractional table lookups", () => {
    expect(tQuantile975(0)).toBeNaN();
    expect(tQuantile975(Number.NaN)).toBeNaN();
    expect(() => tQuantile975(2.5)).toThrow(RangeError);
  });
});

describe("pairedLogRatio", () => {
  const slower = [
    { base: 1, head: 1.2 },
    { base: 1, head: 1.25 },
    { base: 1, head: 1.15 },
  ];

  it("returns the geometric-mean ratio with a 95% t interval", () => {
    const d = slower.map(({ base, head }) => Math.log(head / base));
    const m = mean(d);
    const half = (tQuantile975(2) * stdev(d)) / Math.sqrt(3);
    const e = pairedLogRatio(slower);
    expect(e.n).toBe(3);
    expect(e.ratio).toBeCloseTo(Math.exp(m), 12);
    expect(e.lo).toBeCloseTo(Math.exp(m - half), 12);
    expect(e.hi).toBeCloseTo(Math.exp(m + half), 12);
  });

  it("gives the exact permutation p: 2 of 8 sign masks for three positive differences", () => {
    expect(pairedLogRatio(slower).p).toBe(0.25);
  });

  it("has no interval or p for a single pair", () => {
    const e = pairedLogRatio([{ base: 2, head: 3 }]);
    expect(e.ratio).toBeCloseTo(1.5, 12);
    expect(e.lo).toBeNaN();
    expect(e.hi).toBeNaN();
    expect(e.p).toBeNaN();
  });

  it("is symmetric in base and head", () => {
    const swapped = pairedLogRatio(slower.map(({ base, head }) => ({ base: head, head: base })));
    const e = pairedLogRatio(slower);
    expect(swapped.ratio).toBeCloseTo(1 / e.ratio, 12);
    expect(swapped.lo).toBeCloseTo(1 / e.hi, 12);
    expect(swapped.p).toBe(e.p);
  });

  it("gives p = 1 when nothing changed", () => {
    const e = pairedLogRatio([
      { base: 5, head: 5 },
      { base: 7, head: 7 },
    ]);

    expect(e).toEqual({ n: 2, ratio: 1, lo: 1, hi: 1, p: 1 });
  });

  it("enumerates every sign mask up to 20 pairs", () => {
    const pairs = [1.1, 0.95, 1.2, 1.05, 0.9, 1.3, 1.15, 0.98, 1.07, 1.12].map((head) => ({
      base: 1,
      head,
    }));

    const d = pairs.map(({ head }) => Math.log(head));
    expect(pairedLogRatio(pairs).p).toBeCloseTo(referenceSignFlipP(d), 12);
    expect(pairedLogRatio(pairs.map(() => ({ base: 1, head: 1.1 }))).p).toBe(2 / 1024);
  });

  it("estimates p from seeded random masks above 20 pairs", () => {
    const heads = Array.from({ length: 21 }, (_, i) => 1 + ((i * 37) % 11) / 100 - 0.03);
    const pairs = heads.map((head) => ({ base: 1, head }));
    const exact = referenceSignFlipP(heads.map(Math.log));
    const e = pairedLogRatio(pairs, "seed-a");
    expect(Math.abs(e.p - exact)).toBeLessThan(0.01);
    expect(pairedLogRatio(pairs, "seed-a").p).toBe(e.p);
    expect(pairedLogRatio(pairs, "seed-b").p).not.toBe(e.p);
    // ln 2 and ln 0.5 cancel exactly, so the observed sum is 0 and every mask reaches it.
    const balanced = Array.from({ length: 30 }, (_, i) => ({ base: 1, head: i % 2 ? 0.5 : 2 }));
    expect(pairedLogRatio(balanced).p).toBe(1);
  });

  it("rejects values a ratio cannot be taken of", () => {
    expect(() => pairedLogRatio([{ base: 0, head: 1 }])).toThrow(RangeError);
    expect(() => pairedLogRatio([{ base: 1, head: Number.NaN }])).toThrow(RangeError);
  });
});

describe("holm", () => {
  it("adjusts step-down and keeps the adjusted values monotone", () => {
    const adjusted = holm([0.01, 0.04, 0.03]);
    expect(adjusted[0]).toBeCloseTo(0.03, 12);
    expect(adjusted[1]).toBeCloseTo(0.06, 12);
    expect(adjusted[2]).toBeCloseTo(0.06, 12);
  });

  it("caps at 1, passes NaN through and leaves it out of m", () => {
    expect(holm([0.6, 0.7])).toEqual([1, 1]);
    const adjusted = holm([0.02, Number.NaN]);
    expect(adjusted[0]).toBe(0.02);
    expect(adjusted[1]).toBeNaN();
    expect(holm([])).toEqual([]);
  });
});

describe("pooledWithinSd", () => {
  it("pools squared deviations from each group's own mean", () => {
    expect(
      pooledWithinSd([
        [1, 3],
        [10, 14],
      ]),
    ).toBeCloseTo(Math.sqrt(5), 12);
    expect(pooledWithinSd([[5], [1, 2, 3]])).toBeCloseTo(1, 12);
  });

  it("is null without a group of two and rejects empty groups", () => {
    expect(pooledWithinSd([[1], [2]])).toBeNull();
    expect(() => pooledWithinSd([[1, 2], []])).toThrow(RangeError);
  });
});

describe("linearFit", () => {
  it("recovers an exact line", () => {
    const fit = linearFit([
      [0, 2],
      [1, 5],
      [4, 14],
    ]);

    expect(fit.intercept).toBeCloseTo(2, 12);
    expect(fit.slope).toBeCloseTo(3, 12);
  });

  it("minimises squared error on noisy points", () => {
    const fit = linearFit([
      [1, 1],
      [2, 3],
      [3, 2],
    ]);

    expect(fit.slope).toBeCloseTo(0.5, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
  });

  it("has no slope with fewer than two distinct x", () => {
    expect(linearFit([[1, 2]]).slope).toBeNaN();
    expect(linearFit([]).intercept).toBeNaN();
    expect(
      linearFit([
        [2, 1],
        [2, 3],
      ]).slope,
    ).toBeNaN();
  });
});

describe("classifyChange", () => {
  const estimate = (ratio: number, lo: number, hi: number, n = 18): PairedEstimate => ({
    n,
    ratio,
    lo,
    hi,
    p: 0.001,
  });

  const threshold = 0.1;

  it("calls a regression only when the interval clears the threshold and p is significant", () => {
    expect(classifyChange(estimate(1.25, 1.18, 1.32), { threshold })).toBe("regressed");
    expect(classifyChange(estimate(1.25, 1.18, 1.32), { threshold, pAdjusted: 0.2 })).toBe(
      "slower",
    );
  });

  it("calls slower and faster from the interval and the practical floor", () => {
    expect(classifyChange(estimate(1.06, 1.03, 1.09), { threshold })).toBe("slower");
    expect(classifyChange(estimate(0.88, 0.85, 0.91), { threshold })).toBe("faster");
    expect(classifyChange(estimate(1.02, 1.005, 1.035), { threshold })).toBe("unchanged");
    expect(classifyChange(estimate(1.02, 1.005, 1.035), { threshold, floor: 0.01 })).toBe("slower");
  });

  it("is inconclusive when the interval is wider than the threshold", () => {
    expect(classifyChange(estimate(1.02, 0.918, 1.124), { threshold })).toBe("inconclusive");
  });

  it("is unchanged inside a narrow interval around 1", () => {
    expect(classifyChange(estimate(1.006, 0.979, 1.034), { threshold })).toBe("unchanged");
  });

  it("is unknown without two pairs", () => {
    const single = pairedLogRatio([{ base: 1, head: 2 }]);
    expect(classifyChange(single, { threshold })).toBe("unknown");
  });
});
