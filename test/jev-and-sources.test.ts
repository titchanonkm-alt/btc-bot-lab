import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GEMINI, makeGeminiArm, toProbabilities } from "../src/arms/gemini.js";
import { JEV, makeJevArm } from "../src/arms/jev.js";
import { closedOnly, coinbaseBtc, twelveData, type Fetcher } from "../src/prices/sources.js";
import { serviceAccountJwt } from "../src/sheets.js";
import { series } from "./helpers.js";

const json = (body: unknown, status = 200): Fetcher => async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const jevReply = (asset: number, cash: number) =>
  json({ answers: { position: { type: "choice", choice: asset >= cash ? "asset" : "cash", probabilities: { asset, cash } } } });

describe("jev arm", () => {
  const candles = series(60, 100, 1);
  const decide = (fetcher: Fetcher, holding = false, apiKey: string | undefined = "k") =>
    makeJevArm({ fetcher, apiKey, asset: "BTC" }).decide({ candles, holding, state: {} });

  it("buys at 61% and records the entry price", async () => {
    const d = await decide(jevReply(0.61, 0.39));
    expect(d).toMatchObject({ target: "asset", state: { entry: candles.at(-1)!.c } });
  });

  it("stays in cash at 59%", async () => {
    expect((await decide(jevReply(0.59, 0.41))).target).toBe("cash");
  });

  it("sells when holding and cash reaches the threshold", async () => {
    expect((await decide(jevReply(0.4, 0.6), true)).target).toBe("cash");
  });

  it("keeps the position on an HTTP error and says why", async () => {
    const d = await decide(json({}, 429), true);
    expect(d).toMatchObject({ target: "asset", reason: "error: HTTP 429" });
  });

  it("keeps the position when the key is missing", async () => {
    expect((await decide(jevReply(0.9, 0.1), false, "")).reason).toMatch(/not set/);
  });

  it("sends the documented request shape", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const spy: Fetcher = async (url, init) => {
      sent = { url, body: JSON.parse(String(init!.body)) };
      return jevReply(0.5, 0.5)(url);
    };
    await decide(spy);
    expect(sent!.url).toBe(JEV.endpoint);
    expect(sent!.body.model).toBe("typesafe-ai/jev");
    const state = sent!.body.state as { candles: unknown[]; indicators: Record<string, number> };
    expect(state.candles).toHaveLength(32);
    expect(Object.keys(state.indicators)).toEqual(["ema20", "ema50", "rsi14"]);
  });
});

describe("decision-1 arm", () => {
  it("uses the same question with Microsoft's model and its own id", async () => {
    let model = "";
    const spy: Fetcher = async (url, init) => {
      model = JSON.parse(String(init!.body)).model;
      return jevReply(0.7, 0.3)(url);
    };
    const arm = makeJevArm({ fetcher: spy, apiKey: "k", asset: "XAU", id: "decision1" });
    const d = await arm.decide({ candles: series(60, 100, 1), holding: false, state: {} });
    expect(arm.id).toBe("decision1");
    expect(model).toBe("microsoft/microsoft-decision-1");
    expect(d).toMatchObject({ target: "asset", reason: "decision1 asset 70%" });
  });
});

describe("price sources", () => {
  const now = Date.UTC(2026, 9, 19, 10, 7);

  it("drops the candle that is still open and sorts oldest first", () => {
    const open = { t: Date.UTC(2026, 9, 19, 10, 0), o: 1, h: 1, l: 1, c: 1, v: 1 };
    const closed = { ...open, t: Date.UTC(2026, 9, 19, 9, 45) };
    expect(closedOnly([open, closed, closed], now)).toEqual([closed]);
  });

  it("parses Coinbase rows (time, low, high, open, close, volume)", async () => {
    const t = Date.UTC(2026, 9, 19, 9, 45) / 1000;
    const c = await coinbaseBtc(json([[t, 10, 20, 12, 18, 5]]), now);
    expect(c).toEqual([{ t: t * 1000, o: 12, h: 20, l: 10, c: 18, v: 5 }]);
  });

  it("parses Twelve Data rows as UTC with no volume", async () => {
    const c = await twelveData(
      json({ status: "ok", values: [{ datetime: "2026-10-19 09:45:00", open: "1", high: "2", low: "0.5", close: "1.5" }] }),
      "XAU",
      "key",
      now,
    );
    expect(c).toEqual([{ t: Date.UTC(2026, 9, 19, 9, 45), o: 1, h: 2, l: 0.5, c: 1.5, v: null }]);
  });

  it("surfaces a Twelve Data plan error instead of returning nothing", async () => {
    await expect(twelveData(json({ status: "error", message: "plan" }), "XAU", "k", now)).rejects.toThrow("plan");
  });
});

describe("google service account JWT", () => {
  it("is a verifiable RS256 token for the Sheets scope", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = serviceAccountJwt({ client_email: "bot@x.iam.gserviceaccount.com", private_key: pem }, 1_000);
    const [h, c, s] = jwt.split(".");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "bot@x.iam.gserviceaccount.com", exp: 4_600 });
    expect(claims.scope).toContain("spreadsheets");
  });
});

describe("gemini arm", () => {
  const candles = series(60, 100, 1);
  const reply = (choice: string, confidence: number, status = 200): Fetcher => async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ choice, confidence }) }] } }] }),
      { status },
    );
  const decide = (f: Fetcher, holding = false, apiKey = "k") =>
    makeGeminiArm({ fetcher: f, apiKey, asset: "BTC", retryDelaysMs: [] }).decide({ candles, holding, state: {} });

  it("buys when it picks asset with 70% confidence", async () => {
    expect(await decide(reply("asset", 0.7))).toMatchObject({ target: "asset", reason: "gemini asset 70%" });
  });

  it("stays in cash below the 60% threshold", async () => {
    expect((await decide(reply("asset", 0.55))).target).toBe("cash");
  });

  it("reads a confident cash answer as a sell when holding", async () => {
    expect((await decide(reply("cash", 0.8), true)).target).toBe("cash");
  });

  it("keeps the position on quota errors", async () => {
    expect(await decide(reply("asset", 0.9, 429), true)).toMatchObject({ target: "asset", reason: "error: HTTP 429" });
  });

  it("keeps the position when the key is missing", async () => {
    expect((await decide(reply("asset", 0.9), false, "")).reason).toMatch(/GEMINI_API_KEY not set/);
  });

  it("asks for JSON with the same market state Jev gets", async () => {
    let sent: { url: string; headers: Record<string, string>; body: any } | null = null;
    const spy: Fetcher = async (url, init) => {
      sent = { url, headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) };
      return reply("cash", 0.5)(url);
    };
    await decide(spy);
    expect(sent!.url).toBe(GEMINI.endpoint(GEMINI.model));
    expect(sent!.headers["x-goog-api-key"]).toBe("k");
    expect(sent!.body.generationConfig.responseMimeType).toBe("application/json");
    expect(JSON.parse(sent!.body.contents[0].parts[0].text).candles).toHaveLength(32);
  });

  it("rejects malformed answers", () => {
    expect(toProbabilities(JSON.stringify({ choice: "maybe", confidence: 1 }))).toBeUndefined();
    expect(toProbabilities(JSON.stringify({ choice: "cash", confidence: 1.4 }))).toEqual({ asset: 0, cash: 1 });
  });
});

describe("gemini arm retries", () => {
  it("asks again without the thinking setting when the model answers 400", async () => {
    const bodies: any[] = [];
    const f: Fetcher = async (_url, init) => {
      bodies.push(JSON.parse(String(init!.body)));
      if (bodies.length === 1) return new Response("{}", { status: 400 });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ choice: "asset", confidence: 0.8 }) }] } }] }),
      );
    };
    const d = await makeGeminiArm({ fetcher: f, apiKey: "k", asset: "BTC" }).decide({ candles: series(60, 100, 1), holding: false, state: {} });
    expect(bodies[0].generationConfig.thinkingConfig).toBeDefined();
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
    expect(d.target).toBe("asset");
  });
});

describe("gemini arm on an overloaded server", () => {
  const ok = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ choice: "asset", confidence: 0.9 }) }] } }] });
  const run = async (statuses: number[]) => {
    let i = 0;
    const f: Fetcher = async () => {
      const status = statuses[i++] ?? 200;
      return new Response(status === 200 ? ok : "{}", { status });
    };
    const arm = makeGeminiArm({ fetcher: f, apiKey: "k", asset: "BTC", retryDelaysMs: [0, 0] });
    const d = await arm.decide({ candles: series(60, 100, 1), holding: false, state: {} });
    return { d, calls: i };
  };

  it("retries a 503 and uses the later answer", async () => {
    const { d, calls } = await run([503, 200]);
    expect(calls).toBe(2);
    expect(d.target).toBe("asset");
  });

  it("gives up after three tries and keeps the position", async () => {
    const { d, calls } = await run([503, 503, 503]);
    expect(calls).toBe(3);
    expect(d).toMatchObject({ target: "cash", reason: "error: HTTP 503 after 3 tries" });
  });

  it("does not retry a 403", async () => {
    const { calls } = await run([403]);
    expect(calls).toBe(1);
  });
});
