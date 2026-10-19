import type { AssetId, Candle } from "../types.js";

export const QUARTER = 900_000; // 15 minutes in ms

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Keeps only candles that have fully closed by `now`, sorted oldest first, without duplicates. */
export function closedOnly(candles: Candle[], now: number): Candle[] {
  const seen = new Map<number, Candle>();
  for (const c of candles) if (c.t + QUARTER <= now) seen.set(c.t, c);
  return [...seen.values()].sort((a, b) => a.t - b.t);
}

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const res = await fetcher(url, { headers: { "User-Agent": "btc-bot-lab" } });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

/** Coinbase Exchange: [time(s), low, high, open, close, volume], newest first, max 300 per call. */
export async function coinbaseBtc(fetcher: Fetcher, now: number): Promise<Candle[]> {
  const rows = (await getJson(
    fetcher,
    "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900",
  )) as number[][];
  return closedOnly(
    rows.map(([t, l, h, o, c, v]) => ({ t: t! * 1000, o: o!, h: h!, l: l!, c: c!, v: v! })),
    now,
  );
}

/** Kraken: [time(s), open, high, low, close, vwap, volume, count] as strings; fallback for BTC. */
export async function krakenBtc(fetcher: Fetcher, now: number): Promise<Candle[]> {
  const body = (await getJson(fetcher, "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15")) as {
    error: string[];
    result: Record<string, unknown>;
  };
  if (body.error?.length) throw new Error(`kraken ${body.error.join(",")}`);
  const key = Object.keys(body.result).find((k) => k !== "last")!;
  const rows = body.result[key] as (string | number)[][];
  return closedOnly(
    rows.map((r) => ({
      t: Number(r[0]) * 1000,
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[6]),
    })),
    now,
  );
}

const TWELVE_SYMBOL: Record<Exclude<AssetId, "BTC">, string> = { XAU: "XAU/USD", USDTHB: "USD/THB" };

/** Twelve Data time_series in UTC. Gold and FX have no central volume, so volume is null. */
export async function twelveData(
  fetcher: Fetcher,
  asset: Exclude<AssetId, "BTC">,
  apiKey: string,
  now: number,
): Promise<Candle[]> {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(TWELVE_SYMBOL[asset])}` +
    `&interval=15min&outputsize=300&timezone=UTC&apikey=${encodeURIComponent(apiKey)}`;
  const body = (await getJson(fetcher, url)) as {
    status?: string;
    message?: string;
    values?: { datetime: string; open: string; high: string; low: string; close: string }[];
  };
  if (body.status !== "ok" || !body.values) throw new Error(`twelvedata ${asset}: ${body.message ?? body.status}`);
  return closedOnly(
    body.values.map((v) => ({
      t: Date.parse(v.datetime.replace(" ", "T") + "Z"),
      o: Number(v.open),
      h: Number(v.high),
      l: Number(v.low),
      c: Number(v.close),
      v: null,
    })),
    now,
  );
}

export interface PriceDeps {
  fetcher: Fetcher;
  now: number;
  twelveDataKey?: string;
}

/** Candles for one asset. BTC falls back from Coinbase to Kraken. */
export async function candlesFor(asset: AssetId, deps: PriceDeps): Promise<Candle[]> {
  if (asset === "BTC") {
    try {
      return await coinbaseBtc(deps.fetcher, deps.now);
    } catch {
      return krakenBtc(deps.fetcher, deps.now);
    }
  }
  if (!deps.twelveDataKey) throw new Error("MARKET_DATA_KEY is not set");
  return twelveData(deps.fetcher, asset, deps.twelveDataKey, deps.now);
}
