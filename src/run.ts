import { makeJevArm } from "./arms/jev.js";
import { emaArm, holdArm, rsiArm, taArm } from "./arms/rules.js";
import { CONFIG } from "./config.js";
import { HEADERS, emptyRows, newAssetBook, stepAsset, type BotState, type Rows } from "./engine.js";
import { candlesFor, type Fetcher } from "./prices/sources.js";
import { Sheet, type ServiceAccount } from "./sheets.js";
import type { Arm, AssetId } from "./types.js";

/**
 * One run: read state from the Sheet, decide on the newest closed candle of every asset, log, save state.
 * `RESET=count` (or `RESET=shakedown`) wipes every book, locks a fresh USD/THB rate and starts that phase.
 */
export async function main(env: NodeJS.ProcessEnv, fetcher: Fetcher = fetch): Promise<Rows> {
  const now = Date.now();
  const runAt = new Date(now).toISOString();
  const sheet = new Sheet(fetcher, need(env, "SHEET_ID"), JSON.parse(need(env, "GOOGLE_SA_JSON")) as ServiceAccount);
  await sheet.ensureTabs({ ...HEADERS, State: [] });

  const saved = await sheet.readCell("State", "A1");
  let state: BotState | null = saved ? (JSON.parse(saved) as BotState) : null;
  const reset = env.RESET === "count" || env.RESET === "shakedown" ? env.RESET : null;
  const deps = { fetcher, now, twelveDataKey: env.MARKET_DATA_KEY };

  if (!state || reset) {
    const usdThb = (await candlesFor("USDTHB", deps)).at(-1)?.c;
    if (!usdThb) throw new Error("cannot lock a USD/THB rate: no USD/THB candle");
    state = { phase: reset ?? "shakedown", startedAt: runAt, assets: {} };
    for (const a of CONFIG.assets) state.assets[a] = newAssetBook(a, a === "USDTHB" ? 1 : usdThb, CONFIG.arms);
  }

  const rows = emptyRows();
  for (const asset of CONFIG.assets) {
    const book = state.assets[asset];
    if (!book) continue;
    try {
      const candles = await candlesFor(asset, deps);
      const arms = armsFor(asset, fetcher, env.AI_GATEWAY_API_KEY);
      state.assets[asset] = await stepAsset(asset, candles, book, arms, state.phase, runAt, rows);
    } catch (e) {
      // One asset failing never stops the others; the gap shows up as missed candles next run.
      rows.runs.push([runAt, asset, "", "", "", `error: ${(e as Error).message}`]);
    }
  }

  await sheet.append("Runs", rows.runs);
  await sheet.append("Decisions", rows.decisions);
  await sheet.append("Trades", rows.trades);
  await sheet.append("Equity", rows.equity);
  await sheet.writeCells("State", "A1:B1", [[JSON.stringify(state), runAt]]);
  return rows;
}

function armsFor(asset: AssetId, fetcher: Fetcher, aiKey: string | undefined): Arm[] {
  const all: Record<string, Arm> = {
    ema: emaArm,
    rsi: rsiArm,
    ta: taArm,
    hold: holdArm,
    jev: makeJevArm({ fetcher, apiKey: aiKey, asset, id: "jev" }),
    decision1: makeJevArm({ fetcher, apiKey: aiKey, asset, id: "decision1" }),
  };
  return CONFIG.arms.map((id) => all[id]!);
}

function need(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Until the Sheet secrets exist, scheduled runs exit quietly instead of failing every 15 minutes.
  if (!process.env.SHEET_ID || !process.env.GOOGLE_SA_JSON) {
    console.log("not configured yet: SHEET_ID / GOOGLE_SA_JSON missing, skipping run");
    process.exit(0);
  }
  main(process.env)
    .then((r) => console.log(r.runs.map((x) => x.join(" | ")).join("\n")))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
