/**
 * Manual check of every outside service, run from GitHub Actions with the real secrets.
 * Prints what works and what does not. Never prints a key.
 */
import { JEV } from "./arms/jev.js";
import { candlesFor } from "./prices/sources.js";
import type { AssetId } from "./types.js";

const env = process.env;
const now = Date.now();
const line = (name: string, ok: boolean, detail: string) => console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${detail}`);

for (const asset of ["BTC", "XAU", "USDTHB"] as AssetId[]) {
  try {
    const c = await candlesFor(asset, { fetcher: fetch, now, twelveDataKey: env.MARKET_DATA_KEY });
    const last = c.at(-1);
    const ageMin = last ? Math.round((now - last.t) / 60_000) : -1;
    line(`prices ${asset}`, c.length >= 200, `${c.length} closed candles, last ${last?.c} (${ageMin} min old)`);
  } catch (e) {
    line(`prices ${asset}`, false, (e as Error).message);
  }
}

try {
  const res = await fetch(JEV.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AI_GATEWAY_API_KEY ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JEV.model,
      state: "Probe from btc-bot-lab.",
      questions: { ok: { type: "boolean", instructions: "Is this a probe message?" } },
    }),
  });
  const body = await res.text();
  line("jev via Vercel", res.ok, res.ok ? body.slice(0, 160) : `HTTP ${res.status} ${body.slice(0, 160)}`);
} catch (e) {
  line("jev via Vercel", false, (e as Error).message);
}

line("google service account", Boolean(env.GOOGLE_SA_JSON), env.GOOGLE_SA_JSON ? "secret present" : "GOOGLE_SA_JSON not set");
line("sheet id", Boolean(env.SHEET_ID), env.SHEET_ID ? "secret present" : "SHEET_ID not set");
