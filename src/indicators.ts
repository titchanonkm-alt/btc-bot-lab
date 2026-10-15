import type { Candle } from "./types.js";

/** Exponential moving average. Seeded with the SMA of the first `period` values; earlier entries are NaN. */
export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** No movement at all reads as neutral (50), not overbought. */
function rsiValue(gain: number, loss: number): number {
  if (gain === 0 && loss === 0) return 50;
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

/** Wilder's RSI. Entries before index `period` are NaN. */
export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = rsiValue(gain, loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiValue(gain, loss);
  }
  return out;
}

/** Simple moving average of the last `period` values, or NaN when there are too few. */
export function smaLast(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

const HOUR = 3_600_000;

/** Groups 15-minute candles into 1-hour candles aligned to the UTC hour. Only complete hours (4 candles) are kept. */
export function toHourly(candles: Candle[]): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    const key = Math.floor(c.t / HOUR) * HOUR;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  const out: Candle[] = [];
  for (const [t, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (g.length !== 4) continue;
    out.push({
      t,
      o: g[0]!.o,
      h: Math.max(...g.map((x) => x.h)),
      l: Math.min(...g.map((x) => x.l)),
      c: g[3]!.c,
      v: g.every((x) => x.v !== null) ? g.reduce((a, x) => a + (x.v ?? 0), 0) : null,
    });
  }
  return out;
}

/** Lowest low of the `n` candles before the last one (the last candle is excluded). */
export function priorLow(candles: Candle[], n: number): number {
  const slice = candles.slice(-n - 1, -1);
  if (slice.length < n) return NaN;
  return Math.min(...slice.map((c) => c.l));
}
