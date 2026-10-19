import { CONFIG } from "./config.js";
import { buyAll, equity, isHolding, newLedger, sellAll, type Ledger } from "./ledger.js";
import { QUARTER } from "./prices/sources.js";
import type { Arm, AssetId, Candle } from "./types.js";

export type Phase = "shakedown" | "count";

export interface ArmBook {
  withCost: Ledger;
  noCost: Ledger;
  armState: Record<string, number>;
}

export interface AssetBook {
  /** Open time of the last candle decided on; a candle is never decided twice. */
  lastCandle: number | null;
  /** Quote currency to THB, locked at reset (1 for USD/THB, whose quote is THB). */
  thbRate: number;
  arms: Record<string, ArmBook>;
}

export interface BotState {
  phase: Phase;
  startedAt: string;
  assets: Partial<Record<AssetId, AssetBook>>;
}

export interface Rows {
  runs: (string | number)[][];
  decisions: (string | number)[][];
  trades: (string | number)[][];
  equity: (string | number)[][];
}

export const HEADERS = {
  Runs: ["run_at", "asset", "candle_time", "close", "missed_candles", "status"],
  Decisions: ["run_at", "phase", "asset", "arm", "candle_time", "target", "reason"],
  Trades: ["run_at", "phase", "asset", "arm", "side", "price", "units", "fee_thb", "reason"],
  Equity: ["run_at", "phase", "asset", "arm", "equity_thb", "equity_thb_no_cost", "holding"],
};

export function emptyRows(): Rows {
  return { runs: [], decisions: [], trades: [], equity: [] };
}

/** Fresh books for one asset: every arm starts in cash with the same THB amount. */
export function newAssetBook(asset: AssetId, thbRate: number, armIds: string[]): AssetBook {
  const startQuote = CONFIG.startThb / thbRate;
  const arms: Record<string, ArmBook> = {};
  for (const id of armIds) {
    arms[id] = {
      withCost: newLedger(startQuote, CONFIG.costPerSide[asset]),
      noCost: newLedger(startQuote, 0),
      armState: {},
    };
  }
  return { lastCandle: null, thbRate, arms };
}

const iso = (t: number) => new Date(t).toISOString();

/**
 * Runs every arm on the newest closed candle of one asset, if it has not been decided yet.
 * Pure apart from the arms themselves: returns the new book and the rows to log.
 */
export async function stepAsset(
  asset: AssetId,
  candles: Candle[],
  book: AssetBook,
  arms: Arm[],
  phase: Phase,
  runAt: string,
  rows: Rows,
): Promise<AssetBook> {
  const last = candles.at(-1);
  if (!last) {
    rows.runs.push([runAt, asset, "", "", "", "no candles"]);
    return book;
  }
  if (book.lastCandle !== null && last.t <= book.lastCandle) {
    rows.runs.push([runAt, asset, iso(last.t), last.c, 0, "no new candle"]);
    return book;
  }
  const missed = book.lastCandle === null ? 0 : Math.max(0, (last.t - book.lastCandle) / QUARTER - 1);
  rows.runs.push([runAt, asset, iso(last.t), last.c, missed, "ok"]);

  const next: AssetBook = { ...book, lastCandle: last.t, arms: { ...book.arms } };
  for (const arm of arms) {
    const ab = next.arms[arm.id];
    if (!ab) continue;
    const holding = isHolding(ab.withCost);
    const d = await arm.decide({ candles, holding, state: ab.armState });
    let { withCost, noCost } = ab;
    const wantAsset = d.target === "asset";
    if (wantAsset !== holding) {
      const price = d.price ?? last.c;
      const feesBefore = withCost.feesPaid;
      withCost = wantAsset ? buyAll(withCost, price) : sellAll(withCost, price);
      noCost = wantAsset ? buyAll(noCost, price) : sellAll(noCost, price);
      rows.trades.push([
        runAt,
        phase,
        asset,
        arm.id,
        wantAsset ? "buy" : "sell",
        price,
        wantAsset ? withCost.units : ab.withCost.units,
        round2((withCost.feesPaid - feesBefore) * book.thbRate),
        d.reason,
      ]);
    }
    next.arms[arm.id] = { withCost, noCost, armState: d.state ?? ab.armState };
    rows.decisions.push([runAt, phase, asset, arm.id, iso(last.t), d.target, d.reason]);
    rows.equity.push([
      runAt,
      phase,
      asset,
      arm.id,
      round2(equity(withCost, last.c) * book.thbRate),
      round2(equity(noCost, last.c) * book.thbRate),
      isHolding(withCost) ? "asset" : "cash",
    ]);
  }
  return next;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
