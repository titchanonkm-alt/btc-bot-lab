import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeGeminiArm } from "./arms/gemini.js";
import { makeJevArm } from "./arms/jev.js";
import { emaArm, holdArm, rsiArm, taArm } from "./arms/rules.js";
import { CONFIG } from "./config.js";
import { HEADERS, emptyRows, newAssetBook, stepAsset, type BotState, type Rows } from "./engine.js";
import { candlesFor, type Fetcher } from "./prices/sources.js";
import { Sheet, type ServiceAccount } from "./sheets.js";
import { buildSiteData, type SiteData } from "./site.js";
import type { Arm, AssetId, Candle } from "./types.js";

/**
 * One run: read state from the Sheet, decide on the newest closed candle of every asset, log, save state.
 * `RESET=count` (or `RESET=shakedown`) wipes every book, locks a fresh USD/THB rate and starts that phase.
 */
export async function main(
  env: NodeJS.ProcessEnv,
  fetcher: Fetcher = fetch,
): Promise<{ rows: Rows; state: BotState; runAt: string; candles: Partial<Record<AssetId, Candle[]>> }> {
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
  const seen: Partial<Record<AssetId, Candle[]>> = {};
  for (const asset of CONFIG.assets) {
    const book = state.assets[asset];
    if (!book) continue;
    try {
      const candles = await candlesFor(asset, deps);
      seen[asset] = candles;
      const arms = armsFor(asset, fetcher, env);
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
  return { rows, state, runAt, candles: seen };
}

function armsFor(asset: AssetId, fetcher: Fetcher, env: NodeJS.ProcessEnv): Arm[] {
  const aiKey = env.AI_GATEWAY_API_KEY;
  const all: Record<string, Arm> = {
    ema: emaArm,
    rsi: rsiArm,
    ta: taArm,
    hold: holdArm,
    jev: makeJevArm({ fetcher, apiKey: env.OPENROUTER_API_KEY, asset, id: "jev" }),
    decision1: makeJevArm({ fetcher, apiKey: aiKey, asset, id: "decision1" }),
    gemini: makeGeminiArm({ fetcher, apiKey: env.GEMINI_API_KEY, asset }),
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
    .then(({ rows, state, runAt, candles }) => {
      console.log(rows.runs.map((x) => x.join(" | ")).join("\n"));
      // Page data for the public results site; the workflow publishes this file.
      const out = process.env.SITE_DATA;
      if (out) {
        const prev = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as SiteData) : null;
        writeFileSync(out, JSON.stringify(buildSiteData(prev, state, rows, runAt, candles)));
        console.log(`site data written to ${out}`);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
