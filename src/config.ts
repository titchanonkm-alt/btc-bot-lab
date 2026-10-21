import type { AssetId } from "./types.js";

/**
 * Every setting the comparison depends on. Locked when the count starts:
 * changing anything here during the 4 weeks invalidates the comparison.
 */
export const CONFIG = {
  startThb: 10_000,
  assets: ["BTC", "XAU", "USDTHB"] as AssetId[],
  /**
   * Cost per side, as a fraction, based on how Thai retail traders actually trade each asset:
   * - BTC: Thai licensed exchange taker fee, 0.15%.
   * - XAU: gold bar at a Thai gold shop / gold-savings app; the Gold Traders Association buy-sell
   *   spread is 200 THB per baht-weight on ~66,400 THB (13 Oct 2026), ~0.3% round trip = 0.15% per side.
   * - USD/THB: Thai bank transfer rate; average bank buy 33.4256 / sell 33.7596 vs interbank 33.598
   *   (20 Oct 2026), ~0.5% per side.
   */
  costPerSide: { BTC: 0.0015, XAU: 0.0015, USDTHB: 0.005 } satisfies Record<AssetId, number>,
  /** Arms run in this order; the ids appear in every Sheet row. */
  arms: ["ema", "rsi", "ta", "gemini", "jev", "hold"],
};
