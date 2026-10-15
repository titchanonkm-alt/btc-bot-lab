/** One closed candle. `t` = open time in ms (UTC). Volume is null where the market has no central volume (gold, FX). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export type AssetId = "BTC" | "XAU" | "USDTHB";

/** What an arm wants to hold after this candle. */
export type Target = "asset" | "cash";

export interface ArmContext {
  /** Closed 15-minute candles, oldest first. The last one is the candle being decided on. */
  candles: Candle[];
  /** True when the arm currently holds the asset. */
  holding: boolean;
  /** Arm-specific memory carried between runs (stored in the Sheet's State tab). */
  state: Record<string, number>;
}

export interface Decision {
  target: Target;
  /** Fill price when the arm exits at a level other than the close (stop loss / take profit). */
  price?: number;
  reason: string;
  /** Replaces the arm's state for the next run. */
  state?: Record<string, number>;
}

export interface Arm {
  id: string;
  decide(ctx: ArmContext): Decision | Promise<Decision>;
}
