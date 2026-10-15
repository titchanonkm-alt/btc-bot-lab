import { describe, expect, it } from "vitest";
import { buyAll, equity, isHolding, newLedger, sellAll } from "../src/ledger.js";

describe("ledger", () => {
  it("round trip at the same price loses exactly two fees", () => {
    let l = newLedger(10_000, 0.0015);
    l = buyAll(l, 100);
    expect(isHolding(l)).toBe(true);
    l = sellAll(l, 100);
    expect(l.cash).toBeCloseTo(10_000 * 0.9985 ** 2, 6);
    expect(l.feesPaid).toBeCloseTo(10_000 - l.cash, 6);
  });

  it("the zero-cost shadow ledger keeps every baht", () => {
    let l = newLedger(10_000, 0);
    l = sellAll(buyAll(l, 100), 100);
    expect(l.cash).toBe(10_000);
  });

  it("tracks equity while holding", () => {
    const l = buyAll(newLedger(10_000, 0), 100);
    expect(equity(l, 110)).toBeCloseTo(11_000);
  });

  it("ignores a buy while holding and a sell while in cash", () => {
    const held = buyAll(newLedger(10_000, 0.0015), 100);
    expect(buyAll(held, 50)).toBe(held);
    const cash = newLedger(10_000, 0.0015);
    expect(sellAll(cash, 50)).toBe(cash);
  });
});
