import { ema, priorLow, rsi, smaLast, toHourly } from "../indicators.js";
import type { Arm, ArmContext, Decision } from "../types.js";

const closes = (ctx: ArmContext) => ctx.candles.map((c) => c.c);
const keep = (ctx: ArmContext, reason: string): Decision => ({
  target: ctx.holding ? "asset" : "cash",
  reason,
});

/** EMA 20 crosses EMA 50 on 15-minute closes: hold the asset while EMA 20 is above. */
export const emaArm: Arm = {
  id: "ema",
  decide(ctx) {
    const c = closes(ctx);
    const fast = ema(c, 20).at(-1)!;
    const slow = ema(c, 50).at(-1)!;
    if (Number.isNaN(slow)) return keep(ctx, "warmup");
    return fast > slow
      ? { target: "asset", reason: "ema20 above ema50" }
      : { target: "cash", reason: "ema20 below ema50" };
  },
};

/** RSI 14: buy below 30 while in cash, sell above 70 while holding. */
export const rsiArm: Arm = {
  id: "rsi",
  decide(ctx) {
    const r = rsi(closes(ctx), 14).at(-1)!;
    if (Number.isNaN(r)) return keep(ctx, "warmup");
    if (!ctx.holding && r < 30) return { target: "asset", reason: `rsi ${r.toFixed(1)} < 30` };
    if (ctx.holding && r > 70) return { target: "cash", reason: `rsi ${r.toFixed(1)} > 70` };
    return keep(ctx, `rsi ${r.toFixed(1)}`);
  },
};

/** Buy once and never sell: the yardstick. */
export const holdArm: Arm = {
  id: "hold",
  decide: () => ({ target: "asset", reason: "buy and hold" }),
};

/** Settings for the technical-analysis arm. Locked before the count starts. */
export const TA = {
  lookback24h: 96, // 15-minute candles in 24 hours
  swingLookback: 8, // candles used for the stop: lowest low of the last 2 hours
  rsiReclaim: 40,
  rewardRisk: 2,
  supportTolerance: 0.002, // "touched" the 24h low = low within 0.2% of it
  volumeLookback: 20,
};

/**
 * Technical-analysis arm (confluence + stop loss):
 * trend (1h EMA20 > EMA50) + pullback (touch 24h low or RSI reclaims 40) + confirmation
 * (green candle, volume above its 20-candle average when volume exists). Exits at stop,
 * at 2R target, or when the 1h trend turns down.
 */
export const taArm: Arm = {
  id: "ta",
  decide(ctx) {
    const candles = ctx.candles;
    const last = candles.at(-1)!;
    const hourly = toHourly(candles).map((h) => h.c);
    const f1h = ema(hourly, 20).at(-1);
    const s1h = ema(hourly, 50).at(-1);
    if (f1h === undefined || s1h === undefined || Number.isNaN(s1h)) return keep(ctx, "warmup");
    const trendUp = f1h > s1h;

    if (ctx.holding) {
      const sl = ctx.state.sl;
      const tp = ctx.state.tp;
      if (sl !== undefined && last.l <= sl) {
        // A gap through the stop fills at the open, not at the stop.
        return { target: "cash", price: Math.min(last.o, sl), reason: "stop loss", state: {} };
      }
      if (tp !== undefined && last.h >= tp) {
        return { target: "cash", price: Math.max(last.o, tp), reason: "take profit", state: {} };
      }
      if (!trendUp) return { target: "cash", reason: "1h trend turned down", state: {} };
      return { target: "asset", reason: "in trade", state: ctx.state };
    }

    if (!trendUp) return keep(ctx, "1h trend down");
    const low24 = priorLow(candles, TA.lookback24h);
    const r = rsi(candles.map((c) => c.c), 14);
    const rNow = r.at(-1)!;
    const rPrev = r.at(-2)!;
    const touchedSupport = !Number.isNaN(low24) && last.l <= low24 * (1 + TA.supportTolerance);
    const rsiReclaim = rPrev < TA.rsiReclaim && rNow >= TA.rsiReclaim;
    if (!touchedSupport && !rsiReclaim) return keep(ctx, "no pullback");

    const green = last.c > last.o;
    const vols = candles.slice(0, -1).map((c) => c.v);
    const volumeOk =
      last.v === null || vols.some((v) => v === null)
        ? true
        : last.v > smaLast(vols as number[], TA.volumeLookback);
    if (!green || !volumeOk) return keep(ctx, "not confirmed");

    const sl = Math.min(...candles.slice(-TA.swingLookback).map((c) => c.l));
    const risk = last.c - sl;
    if (risk <= 0) return keep(ctx, "no room for a stop");
    return {
      target: "asset",
      reason: touchedSupport ? "pullback to 24h low, confirmed" : "rsi reclaimed 40, confirmed",
      state: { entry: last.c, sl, tp: last.c + TA.rewardRisk * risk },
    };
  },
};
