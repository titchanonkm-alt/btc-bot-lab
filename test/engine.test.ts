import { describe, expect, it } from "vitest";
import { emptyRows, newAssetBook, stepAsset } from "../src/engine.js";
import type { Arm } from "../src/types.js";
import { series } from "./helpers.js";

const always = (id: string, target: "asset" | "cash", price?: number): Arm => ({
  id,
  decide: () => ({ target, reason: "test", ...(price ? { price } : {}) }),
});

describe("stepAsset", () => {
  const candles = series(10, 100, 1); // last close 109
  const run = "2026-11-09T00:02:00.000Z";

  it("starts every arm with 10,000 THB and logs equity in baht", async () => {
    const book = newAssetBook("BTC", 33.5, ["a", "b"]);
    const rows = emptyRows();
    await stepAsset("BTC", candles, book, [always("a", "cash"), always("b", "cash")], "count", run, rows);
    expect(rows.equity.map((r) => r[4])).toEqual([10_000, 10_000]);
  });

  it("buys with cost on one ledger and without on the shadow ledger", async () => {
    const book = newAssetBook("BTC", 33.5, ["a"]);
    const rows = emptyRows();
    const next = await stepAsset("BTC", candles, book, [always("a", "asset")], "count", run, rows);
    expect(rows.trades).toHaveLength(1);
    expect(rows.trades[0]![4]).toBe("buy");
    expect(rows.equity[0]![4]).toBeCloseTo(10_000 * 0.9985, 1);
    expect(rows.equity[0]![5]).toBeCloseTo(10_000, 1);
    expect(next.arms.a!.withCost.units).toBeGreaterThan(0);
  });

  it("never decides the same candle twice", async () => {
    let book = newAssetBook("BTC", 33.5, ["a"]);
    const rows = emptyRows();
    book = await stepAsset("BTC", candles, book, [always("a", "asset")], "count", run, rows);
    book = await stepAsset("BTC", candles, book, [always("a", "cash")], "count", run, rows);
    expect(rows.trades).toHaveLength(1);
    expect(rows.runs.at(-1)![5]).toBe("no new candle");
  });

  it("counts candles missed between runs", async () => {
    let book = newAssetBook("BTC", 33.5, ["a"]);
    const rows = emptyRows();
    book = await stepAsset("BTC", candles.slice(0, 5), book, [always("a", "cash")], "count", run, rows);
    await stepAsset("BTC", candles, book, [always("a", "cash")], "count", run, rows);
    expect(rows.runs.at(-1)![4]).toBe(4);
  });

  it("fills a stop-loss exit at the arm's price, not the close", async () => {
    let book = newAssetBook("BTC", 1, ["a"]);
    const rows = emptyRows();
    book = await stepAsset("BTC", candles.slice(0, 9), book, [always("a", "asset")], "count", run, rows);
    await stepAsset("BTC", candles, book, [always("a", "cash", 50)], "count", run, rows);
    expect(rows.trades.at(-1)!.slice(4, 6)).toEqual(["sell", 50]);
  });

  it("keeps USD/THB in baht with a rate of 1", async () => {
    const book = newAssetBook("USDTHB", 1, ["a"]);
    expect(book.arms.a!.withCost.cash).toBe(10_000);
  });
});
