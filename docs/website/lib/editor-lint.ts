/** Shared contract for the landing-page editor and its lint route. */

export const MAX_SOURCE_BYTES = 8 * 1024;
export const MIN_BASELINE_YEAR = 1995;
export const MAX_BASELINE_YEAR = 2100;
export const DEFAULT_BASELINE_YEAR = 2020;

export type BaselineTarget = "widely" | "newly" | number;

export type LintDiagnostic = {
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
  message: string;
  severity: 1 | 2;
};

export function isBaselineYear(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_BASELINE_YEAR && value <= MAX_BASELINE_YEAR;
}
