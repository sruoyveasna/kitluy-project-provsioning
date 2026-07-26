import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  compare,
  formatAmount,
  khr,
  money,
  MoneyError,
  multiplyByQuantity,
  subtract,
  usdCents,
} from "../src/index.js";

describe("@kitluy/money", () => {
  it("KHR has zero minor-unit digits and USD has two", () => {
    expect(formatAmount(khr(1250000))).toBe("1250000");
    expect(formatAmount(usdCents(1999))).toBe("19.99");
    expect(formatAmount(usdCents(5))).toBe("0.05");
    expect(formatAmount(usdCents(-1999))).toBe("-19.99");
  });

  it("rejects non-integer amounts (floating-point money is prohibited)", () => {
    expect(() => money("USD", 19.99)).toThrow(MoneyError);
    expect(() => khr(0.5)).toThrow(/prohibited/);
  });

  it("adds and subtracts only within one currency", () => {
    expect(add(khr(1000), khr(500)).minorUnits).toBe(1500n);
    expect(subtract(usdCents(500), usdCents(199)).minorUnits).toBe(301n);
    expect(() => add(khr(1000), usdCents(100))).toThrow(/Cannot combine KHR with USD/);
  });

  it("multiplies by integer quantity only", () => {
    expect(multiplyByQuantity(khr(4000), 3).minorUnits).toBe(12000n);
    expect(() => multiplyByQuantity(khr(4000), 2.5)).toThrow(MoneyError);
  });

  it("compares amounts", () => {
    expect(compare(khr(100), khr(200))).toBe(-1);
    expect(compare(usdCents(200), usdCents(200))).toBe(0);
  });

  it("allocate preserves the exact total (no riel created or lost)", () => {
    const parts = allocate(khr(100), [1, 1, 1]);
    expect(parts.map((p) => p.minorUnits)).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((s, p) => s + p.minorUnits, 0n)).toBe(100n);

    const cents = allocate(usdCents(1001), [3, 7]);
    expect(cents.reduce((s, p) => s + p.minorUnits, 0n)).toBe(1001n);
  });

  it("allocate handles negative totals deterministically", () => {
    const parts = allocate(khr(-100), [1, 2]);
    expect(parts.reduce((s, p) => s + p.minorUnits, 0n)).toBe(-100n);
  });

  it("allocate rejects invalid ratios", () => {
    expect(() => allocate(khr(100), [])).toThrow(MoneyError);
    expect(() => allocate(khr(100), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(khr(100), [-1, 2])).toThrow(MoneyError);
  });

  it("bigint sums never lose precision on large values", () => {
    const big = khr(9_007_199_254_740_991); // Number.MAX_SAFE_INTEGER riel
    expect(add(big, khr(1)).minorUnits).toBe(9_007_199_254_740_992n);
  });
});
