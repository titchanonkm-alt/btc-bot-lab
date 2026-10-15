import { describe, expect, it } from "vitest";
import { emaArm, holdArm, rsiArm, taArm } from "../src/arms/rules.js";
import type { ArmContext, Decision } from "../src/types.js";
import { series, withLast } from "./helpers.js";

const ctx = (candles: ArmContext["candles"], holding = false, state = {}): ArmContext => ({
  candles,
  holding,
  state,
});
const run = (d: Decision | Promise<Decision>) => d as Decision;

describe("ema arm", () => {
  it("holds the asset in an uptrend and cash in a downtrend", () => {
    expect(run(emaArm.decide(ctx(series(60, 100, 1)))).target).toBe("asset");
    expect(run(emaArm.decide(ctx(series(60, 200, -1), true))).target).toBe("cash");
  });
  it("keeps its position during warmup", () => {
    const d = run(emaArm.decide(ctx(series(30, 100, 1), true)));
    expect(d).toMatchObject({ target: "asset", reason: "warmup" });
  });
});

describe("rsi arm", () => {
  it("buys when oversold and sells when overbought", () => {
    expect(run(rsiArm.decide(ctx(series(30, 200, -1)))).target).toBe("asset");
    expect(run(rsiArm.decide(ctx(series(30, 100, 1), true))).target).toBe("cash");
  });
  it("does nothing in between", () => {
    const flat = series(30, 100, 0);
    expect(run(rsiArm.decide(ctx(flat, false))).target).toBe("cash");
  });
});

describe("hold arm", () => {
  it("always wants the asset", () => {
    expect(run(holdArm.decide(ctx(series(5, 100, -1), true))).target).toBe("asset");
  });
});

describe("technical-analysis arm", () => {
  const up = series(240, 100, 0.5); // 60 rising hours: 1h trend is up

  it("exits at the stop when price trades through it", () => {
    const c = withLast(up, { o: 200, l: 190, c: 199 });
    const d = run(taArm.decide(ctx(c, true, { sl: 195, tp: 300 })));
    expect(d).toMatchObject({ target: "cash", price: 195, reason: "stop loss" });
  });

  it("fills at the open when the market gaps below the stop", () => {
    const c = withLast(up, { o: 180, l: 179, c: 181 });
    const d = run(taArm.decide(ctx(c, true, { sl: 195, tp: 300 })));
    expect(d).toMatchObject({ target: "cash", price: 180 });
  });

  it("takes profit at the target", () => {
    const last = up.at(-1)!;
    const c = withLast(up, { h: last.c + 10 });
    const d = run(taArm.decide(ctx(c, true, { sl: 1, tp: last.c + 5 })));
    expect(d).toMatchObject({ target: "cash", price: last.c + 5, reason: "take profit" });
  });

  it("stays in while the trend holds and no level is hit", () => {
    const d = run(taArm.decide(ctx(up, true, { sl: 1, tp: 10_000 })));
    expect(d.target).toBe("asset");
  });

  it("exits when the 1h trend turns down", () => {
    const down = series(240, 300, -0.5);
    const d = run(taArm.decide(ctx(down, true, { sl: 1, tp: 10_000 })));
    expect(d).toMatchObject({ target: "cash", reason: "1h trend turned down" });
  });

  it("enters on a confirmed pullback to the 24h low and sets stop and 2R target", () => {
    const low24 = Math.min(...up.slice(-97, -1).map((x) => x.l));
    const prev = up.at(-2)!.c;
    const c = withLast(up, { o: prev - 2, l: low24, h: prev + 1, c: prev });
    const d = run(taArm.decide(ctx(c, false)));
    expect(d.target).toBe("asset");
    const { entry, sl, tp } = d.state!;
    expect(entry).toBe(prev);
    expect(sl).toBe(low24);
    expect(tp).toBeCloseTo(prev + 2 * (prev - low24));
  });

  it("does not enter on a red candle", () => {
    const low24 = Math.min(...up.slice(-97, -1).map((x) => x.l));
    const prev = up.at(-2)!.c;
    const c = withLast(up, { o: prev + 1, l: low24, c: prev });
    expect(run(taArm.decide(ctx(c, false))).target).toBe("cash");
  });

  it("requires above-average volume when volume exists", () => {
    const vol = series(240, 100, 0.5, 10);
    const low24 = Math.min(...vol.slice(-97, -1).map((x) => x.l));
    const prev = vol.at(-2)!.c;
    const quiet = withLast(vol, { o: prev - 2, l: low24, c: prev, v: 5 });
    const loud = withLast(vol, { o: prev - 2, l: low24, c: prev, v: 50 });
    expect(run(taArm.decide(ctx(quiet, false))).reason).toBe("not confirmed");
    expect(run(taArm.decide(ctx(loud, false))).target).toBe("asset");
  });

  it("never enters in a downtrend", () => {
    const down = series(240, 300, -0.5);
    expect(run(taArm.decide(ctx(down, false))).target).toBe("cash");
  });
});
