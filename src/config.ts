import type { AssetId } from "./types.js";

/**
 * Every setting the comparison depends on. Locked when the count starts:
 * changing anything here during the 4 weeks invalidates the comparison.
 */
export const CONFIG = {
  startThb: 10_000,
  assets: ["BTC", "XAU", "USDTHB"] as AssetId[],
  /** Cost per side, as a fraction. Gold and USD/THB are placeholders until the shakedown measures real spreads. */
  costPerSide: { BTC: 0.0015, XAU: 0.0003, USDTHB: 0.0003 } satisfies Record<AssetId, number>,
  /** Arms run in this order; the ids appear in every Sheet row. */
  arms: ["ema", "rsi", "ta", "jev", "hold"],
};
