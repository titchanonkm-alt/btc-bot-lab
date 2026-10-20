/**
 * Manual check of every outside service, run from GitHub Actions with the real secrets.
 * Prints what works and what does not. Never prints a key.
 */
import { GEMINI, makeGeminiArm } from "./arms/gemini.js";
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

// Gemini: which Flash-Lite models this key can use, then one tiny call to the configured model.
const gKey = env.GEMINI_API_KEY ?? "";
try {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": gKey },
  });
  const body = (await res.json()) as { models?: { name: string }[]; error?: { message?: string } };
  const lite = (body.models ?? []).map((m) => m.name.replace("models/", "")).filter((n) => n.includes("flash-lite"));
  line("gemini models", res.ok, res.ok ? `flash-lite: ${lite.join(", ") || "none"}` : `HTTP ${res.status} ${body.error?.message ?? ""}`);
} catch (e) {
  line("gemini models", false, (e as Error).message);
}
try {
  const res = await fetch(GEMINI.endpoint(GEMINI.model), {
    method: "POST",
    headers: { "x-goog-api-key": gKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Probe from btc-bot-lab. Reply with the word ok." }] }],
      generationConfig: { maxOutputTokens: 5 },
    }),
  });
  const body = await res.text();
  line(`gemini ${GEMINI.model}`, res.ok, res.ok ? "answered" : `HTTP ${res.status} ${body.slice(0, 160)}`);
} catch (e) {
  line(`gemini ${GEMINI.model}`, false, (e as Error).message);
}

// A full-size decision on real BTC candles, timed, exactly as the bot makes it.
try {
  const candles = await candlesFor("BTC", { fetcher: fetch, now, twelveDataKey: env.MARKET_DATA_KEY });
  const t0 = Date.now();
  const d = await makeGeminiArm({ fetcher: fetch, apiKey: gKey, asset: "BTC" }).decide({ candles, holding: false, state: {} });
  line("gemini real decision", !d.reason.startsWith("error"), `${d.target} (${d.reason}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  line("gemini real decision", false, (e as Error).message);
}

line("google service account", Boolean(env.GOOGLE_SA_JSON), env.GOOGLE_SA_JSON ? "secret present" : "GOOGLE_SA_JSON not set");
line("sheet id", Boolean(env.SHEET_ID), env.SHEET_ID ? "secret present" : "SHEET_ID not set");
