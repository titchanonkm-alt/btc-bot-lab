import { describe, expect, it } from "vitest";
import type { BotState, Rows } from "../src/engine.js";
import { buildSiteData } from "../src/site.js";

const state = (startedAt = "2026-10-26T00:02:00.000Z"): BotState => ({ phase: "count", startedAt, assets: {} });

const run = (at: string, candle: string, eqEma: number, eqGemini: number, geminiReason = "gemini cash 40% < 60%"): Rows => ({
  runs: [[at, "BTC", candle, 82000, 0, "ok"]],
  decisions: [
    [at, "count", "BTC", "ema", candle, "asset", "ema20 above ema50"],
    [at, "count", "BTC", "gemini", candle, "cash", geminiReason],
  ],
  trades: [[at, "count", "BTC", "ema", "buy", 82000, 0.0036, 15, "ema20 above ema50"]],
  equity: [
    [at, "count", "BTC", "ema", eqEma, eqEma + 15, "asset"],
    [at, "count", "BTC", "gemini", eqGemini, eqGemini, "cash"],
  ],
});

describe("site data", () => {
  it("builds the first snapshot and appends one history point per decided candle", () => {
    const a = buildSiteData(null, state(), run("t1", "c1", 9985, 10000), "t1");
    const b = buildSiteData(a, state(), run("t2", "c2", 10010, 10000, "error: timeout"), "t2");
    expect(b.history.BTC!.t).toEqual(["c1", "c2"]);
    expect(b.history.BTC!.arms.ema).toEqual([9985, 10010]);
    expect(b.assets.BTC!.arms.ema).toMatchObject({ equity: 10010, holding: "asset", reason: "ema20 above ema50" });
    expect(b.assets.BTC!.price).toBe(82000);
    expect(b.ai).toEqual({ decisions: 2, errors: 1 });
    expect(b.trades).toHaveLength(2);
  });

  it("does not add a point when no new candle was decided", () => {
    const a = buildSiteData(null, state(), run("t1", "c1", 9985, 10000), "t1");
    const skip: Rows = { runs: [["t2", "BTC", "c1", 82000, 0, "no new candle"]], decisions: [], trades: [], equity: [] };
    const b = buildSiteData(a, state(), skip, "t2");
    expect(b.history.BTC!.t).toEqual(["c1"]);
    expect(b.assets.BTC!.status).toBe("no new candle");
    expect(b.updatedAt).toBe("t2");
  });

  it("keeps recent candles and works out profit on a sell", () => {
    const candles = { BTC: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: null }] };
    const a = buildSiteData(null, state(), run("t1", "c1", 9985, 10000), "t1", candles);
    expect(a.assets.BTC!.candles).toEqual([[1, 1, 2, 0.5, 1.5]]);
    const sell: Rows = {
      runs: [["t2", "BTC", "c2", 84050, 0, "ok"]],
      decisions: [],
      trades: [["t2", "count", "BTC", "ema", "sell", 84050, 0.0036, 15, "ema20 below ema50"]],
      equity: [],
    };
    const b = buildSiteData(a, state(), sell, "t2");
    expect(b.trades[0]).toMatchObject({ t: "c2", side: "sell", arm: "ema" });
    expect(b.trades[0]!.pnlPct).toBeCloseTo(2.5);
  });

  it("starts over after a reset", () => {
    const a = buildSiteData(null, state("old"), run("t1", "c1", 9985, 10000), "t1");
    const b = buildSiteData(a, state("new"), run("t2", "c2", 10000, 10000), "t2");
    expect(b.history.BTC!.t).toEqual(["c2"]);
    expect(b.startedAt).toBe("new");
  });

  it("does not change the previous snapshot", () => {
    const a = buildSiteData(null, state(), run("t1", "c1", 9985, 10000), "t1");
    buildSiteData(a, state(), run("t2", "c2", 10010, 10000), "t2");
    expect(a.history.BTC!.t).toEqual(["c1"]);
  });
});

describe("site data for several AI arms", () => {
  it("counts answers per AI arm", () => {
    const rows: Rows = {
      runs: [["t1", "BTC", "c1", 82000, 0, "ok"]],
      decisions: [
        ["t1", "count", "BTC", "gemini", "c1", "cash", "error: timeout"],
        ["t1", "count", "BTC", "jev", "c1", "cash", "jev asset 40% < 60%"],
        ["t1", "count", "BTC", "ema", "c1", "asset", "ema20 above ema50"],
      ],
      trades: [],
      equity: [],
    };
    const d = buildSiteData(null, state(), rows, "t1");
    expect(d.aiByArm).toEqual({ gemini: { decisions: 1, errors: 1 }, jev: { decisions: 1, errors: 0 } });
    expect(d.ai).toEqual({ decisions: 2, errors: 1 });
  });
});

describe("site stats", () => {
  const eqRun = (at: string, eq: number, trade = false): Rows => ({
    runs: [[at, "BTC", at, 82000, 0, "ok"]],
    decisions: [],
    trades: trade ? [[at, "count", "BTC", "ema", "buy", 82000, 0.0036, 15, "x"]] : [],
    equity: [[at, "count", "BTC", "ema", eq, eq, "asset"]],
  });

  it("tracks the worst fall from a peak and counts trades", () => {
    let d = buildSiteData(null, state(), eqRun("t1", 10000, true), "t1");
    for (const [t, eq] of [["t2", 10500], ["t3", 9975], ["t4", 10800], ["t5", 10260]] as const) {
      d = buildSiteData(d, state(), eqRun(t, eq, t === "t3"), t);
    }
    // 10500 -> 9975 is -5%; 10800 -> 10260 is also -5% exactly, so -5 stays the worst.
    expect(d.stats!.BTC!.ema).toMatchObject({ peak: 10800, maxDrawdownPct: -5, trades: 2 });
  });
  it("counts round trips, wins and profit factor from cash before the buy and after the sell", () => {
    const step = (at: string, eq: number, holding: string, side?: string): Rows => ({
      runs: [[at, "BTC", at, 82000, 0, "ok"]],
      decisions: [[at, "count", "BTC", "rsi", at, holding, "x"]],
      trades: side ? [[at, "count", "BTC", "rsi", side, 82000, 0.001, 15, "x"]] : [],
      equity: [[at, "count", "BTC", "rsi", eq, eq, holding]],
    });
    let d = buildSiteData(null, state(), step("c1", 10000, "cash"), "c1");
    d = buildSiteData(d, state(), step("c2", 9985, "asset", "buy"), "c2");
    d = buildSiteData(d, state(), step("c3", 10300, "asset"), "c3");
    d = buildSiteData(d, state(), step("c4", 10200, "cash", "sell"), "c4"); // +200 win
    d = buildSiteData(d, state(), step("c5", 10185, "asset", "buy"), "c5");
    d = buildSiteData(d, state(), step("c6", 10050, "cash", "sell"), "c6"); // -150 loss
    expect(d.stats!.BTC!.rsi).toMatchObject({ trades: 4, closed: 2, wins: 1, grossWin: 200, grossLoss: 150, inTrade: false, flatEq: 10050 });
  });

  it("treats an arm that holds from the first candle as having bought with the starting money", () => {
    const step = (at: string, eq: number, holding: string): Rows => ({
      runs: [[at, "BTC", at, 82000, 0, "ok"]], decisions: [], trades: [],
      equity: [[at, "count", "BTC", "ta", eq, eq, holding]],
    });
    let d = buildSiteData(null, state(), step("c1", 9985, "asset"), "c1");
    d = buildSiteData(d, state(), step("c2", 9900, "cash"), "c2");
    expect(d.stats!.BTC!.ta).toMatchObject({ closed: 1, wins: 0, grossLoss: 100 });
  });
});
