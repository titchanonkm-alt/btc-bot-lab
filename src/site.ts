import type { BotState, Rows } from "./engine.js";

/**
 * Everything the public results page shows, in one small JSON file.
 * The bot rebuilds it after every run from the previous file plus that run's rows,
 * and the workflow publishes it to the `data` branch, where the page reads it.
 */
export interface SiteData {
  version: 1;
  phase: string;
  startedAt: string;
  updatedAt: string;
  assets: Record<string, AssetNow>;
  /** Equity in THB (with costs) after each decided candle, one series per arm. */
  history: Record<string, { t: string[]; arms: Record<string, number[]> }>;
  /** Newest first. */
  trades: { t: string; asset: string; arm: string; side: string; price: number; reason: string }[];
  /** How often the AI arm failed to answer, so readers can judge how fair its result is. */
  ai: { decisions: number; errors: number };
}

export interface AssetNow {
  price: number | null;
  candleTime: string | null;
  status: string;
  arms: Record<string, { equity: number; equityNoCost: number; holding: string; reason: string }>;
}

export const SITE_LIMITS = { historyPoints: 4000, trades: 60 };

export function emptySiteData(state: BotState, now: string): SiteData {
  return {
    version: 1,
    phase: state.phase,
    startedAt: state.startedAt,
    updatedAt: now,
    assets: {},
    history: {},
    trades: [],
    ai: { decisions: 0, errors: 0 },
  };
}

const num = (v: string | number | undefined) => (typeof v === "number" ? v : v === undefined || v === "" ? NaN : Number(v));
const str = (v: string | number | undefined) => (v === undefined ? "" : String(v));

/** Adds one run to the page data. A new phase (a reset) starts the page over. */
export function buildSiteData(prev: SiteData | null, state: BotState, rows: Rows, runAt: string): SiteData {
  const fresh = !prev || prev.version !== 1 || prev.startedAt !== state.startedAt;
  const data: SiteData = fresh ? emptySiteData(state, runAt) : structuredClone(prev);
  data.phase = state.phase;
  data.updatedAt = runAt;

  for (const [, asset, candleTime, close, , status] of rows.runs) {
    const a = (data.assets[str(asset)] ??= { price: null, candleTime: null, status: "", arms: {} });
    a.status = str(status);
    if (candleTime !== "") {
      a.candleTime = str(candleTime);
      a.price = num(close);
    }
  }

  const reasons = new Map<string, string>();
  for (const [, , asset, arm, , , reason] of rows.decisions) {
    reasons.set(`${asset}/${arm}`, str(reason));
    if (arm === "gemini") {
      data.ai.decisions++;
      if (str(reason).startsWith("error")) data.ai.errors++;
    }
  }

  // Equity rows exist only for candles that were actually decided; each adds one history point.
  const decidedAssets = new Set<string>();
  for (const [, , asset, arm, eq, eqNoCost, holding] of rows.equity) {
    const key = str(asset);
    const a = (data.assets[key] ??= { price: null, candleTime: null, status: "", arms: {} });
    a.arms[str(arm)] = {
      equity: num(eq),
      equityNoCost: num(eqNoCost),
      holding: str(holding),
      reason: reasons.get(`${key}/${arm}`) ?? "",
    };
    const h = (data.history[key] ??= { t: [], arms: {} });
    if (!decidedAssets.has(key)) {
      decidedAssets.add(key);
      h.t.push(a.candleTime ?? runAt);
    }
    const series = (h.arms[str(arm)] ??= []);
    // An arm that joined late is padded so every series lines up with `t`.
    while (series.length < h.t.length - 1) series.push(NaN);
    series.push(num(eq));
  }
  for (const h of Object.values(data.history)) {
    const drop = h.t.length - SITE_LIMITS.historyPoints;
    if (drop > 0) {
      h.t.splice(0, drop);
      for (const s of Object.values(h.arms)) s.splice(0, drop);
    }
  }

  const newTrades = rows.trades.map(([, , asset, arm, side, price, , , reason]) => ({
    t: runAt,
    asset: str(asset),
    arm: str(arm),
    side: str(side),
    price: num(price),
    reason: str(reason),
  }));
  data.trades = [...newTrades.reverse(), ...data.trades].slice(0, SITE_LIMITS.trades);
  return data;
}
