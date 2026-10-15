import type { Candle } from "../src/types.js";

const Q = 900_000; // 15 minutes
const T0 = Date.UTC(2026, 9, 19, 0, 0); // Mon 19 Oct 2026 00:00 UTC, hour-aligned

/** Steady 15-minute candles whose close moves by `step` each candle. */
export function series(n: number, start: number, step: number, volume: number | null = null): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    const o = c - step * 0.4;
    return { t: T0 + i * Q, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c, v: volume };
  });
}

/** Replaces the last candle's prices (keeps its time). */
export function withLast(candles: Candle[], last: Partial<Candle>): Candle[] {
  const copy = candles.slice();
  copy[copy.length - 1] = { ...copy.at(-1)!, ...last };
  return copy;
}
