import { describe, expect, it } from "vitest";
import { ema, priorLow, rsi, smaLast, toHourly } from "../src/indicators.js";
import { series } from "./helpers.js";

describe("ema", () => {
  it("seeds with the SMA and then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(out.slice(2)).toEqual([2, 3, 4]);
  });
});

describe("rsi", () => {
  it("matches a hand-computed Wilder value", () => {
    const out = rsi([1, 2, 1, 2], 2);
    expect(out[2]).toBeCloseTo(50);
    expect(out[3]).toBeCloseTo(75);
  });
  it("is 100 when price only rises and 0 when it only falls", () => {
    expect(rsi([1, 2, 3, 4, 5], 3).at(-1)).toBe(100);
    expect(rsi([5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
  });
  it("reads a flat market as neutral 50", () => {
    expect(rsi([7, 7, 7, 7, 7], 3).at(-1)).toBe(50);
  });
});

describe("smaLast", () => {
  it("averages the last values", () => {
    expect(smaLast([1, 2, 3, 4], 2)).toBe(3.5);
    expect(smaLast([1], 2)).toBeNaN();
  });
});

describe("toHourly", () => {
  it("builds hourly candles from complete groups of four", () => {
    const h = toHourly(series(10, 100, 1, 2)); // 2 full hours + 2 leftover candles
    expect(h).toHaveLength(2);
    expect(h[0]!.o).toBeCloseTo(99.6);
    expect(h[0]!.c).toBe(103);
    expect(h[0]!.v).toBe(8);
  });
  it("keeps volume null when the market has none", () => {
    expect(toHourly(series(4, 100, 1))[0]!.v).toBeNull();
  });
});

describe("priorLow", () => {
  it("ignores the last candle", () => {
    const c = series(5, 100, 1);
    expect(priorLow(c, 4)).toBe(c[0]!.l);
    expect(priorLow(c, 5)).toBeNaN();
  });
});
