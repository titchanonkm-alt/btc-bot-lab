import type { Fetcher } from "../prices/sources.js";
import type { Arm, ArmContext, Decision } from "../types.js";
import { QUESTION, buildState, decideFromProbabilities } from "./jev.js";

/**
 * Google Gemini on the free tier of Google AI Studio. Flash-Lite allows about 500 requests a day,
 * and the bot needs 288 (every 15 minutes x 3 assets), leaving room for probes and retries.
 */
export const GEMINI = {
  model: "gemini-3.5-flash-lite",
  /** Free-tier latency swings a lot: 10 s and 30 s both timed out in the shakedown. */
  timeoutMs: 45_000,
  /** Free-tier Flash-Lite answers 503 (overloaded) or 429 now and then: wait and ask again. */
  retryDelaysMs: [5_000],
  endpoint: (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
};

/** Same question as Jev, phrased for a chat model that must answer in a fixed JSON shape. */
export const SYSTEM_PROMPT = [
  QUESTION.instructions,
  `Answer "asset" to ${QUESTION.criteria.asset}.`,
  `Answer "cash" to ${QUESTION.criteria.cash}.`,
  "The user message is the market state as JSON. Reply with your choice and your confidence from 0 to 1 that the choice is right.",
].join("\n");

export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    choice: { type: "STRING", enum: ["asset", "cash"] },
    confidence: { type: "NUMBER" },
  },
  required: ["choice", "confidence"],
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Turns {choice, confidence} into the same {asset, cash} probabilities the Jev arm gets. */
export function toProbabilities(text: string | undefined): Record<string, number> | undefined {
  if (!text) return undefined;
  const parsed = JSON.parse(text) as { choice?: string; confidence?: number };
  if ((parsed.choice !== "asset" && parsed.choice !== "cash") || typeof parsed.confidence !== "number") return undefined;
  const p = Math.min(1, Math.max(0, parsed.confidence));
  return parsed.choice === "asset" ? { asset: p, cash: 1 - p } : { asset: 1 - p, cash: p };
}

export function makeGeminiArm(opts: {
  fetcher: Fetcher;
  apiKey: string | undefined;
  asset: string;
  model?: string;
  retryDelaysMs?: number[];
}): Arm {
  const model = opts.model ?? GEMINI.model;
  return {
    id: "gemini",
    async decide(ctx: ArmContext): Promise<Decision> {
      const keep = (reason: string): Decision => ({ target: ctx.holding ? "asset" : "cash", reason, state: ctx.state });
      if (!opts.apiKey) return keep("error: GEMINI_API_KEY not set");
      try {
        const call = (thinking: boolean) =>
          opts.fetcher(GEMINI.endpoint(model), {
            method: "POST",
            headers: { "x-goog-api-key": opts.apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: JSON.stringify(buildState(ctx, opts.asset)) }] }],
              generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                responseSchema: RESPONSE_SCHEMA,
                // Keep thinking short so a 15-minute decision returns in seconds.
                ...(thinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
              },
            }),
            signal: AbortSignal.timeout(GEMINI.timeoutMs),
          });
        const attempt = async (): Promise<Response> => {
          try {
            const first = await call(true);
            // A model that rejects the thinking setting answers 400; ask once more without it.
            return first.status === 400 ? await call(false) : first;
          } catch (e) {
            // A timeout is retried like an overload; anything else is a real error.
            if ((e as Error).name === "TimeoutError") return new Response(null, { status: 504 });
            throw e;
          }
        };
        let res = await attempt();
        let tries = 1;
        for (const delay of opts.retryDelaysMs ?? GEMINI.retryDelaysMs) {
          if (![429, 500, 503, 504].includes(res.status)) break;
          await new Promise((r) => setTimeout(r, delay));
          res = await attempt();
          tries++;
        }
        if (!res.ok) {
          const what = res.status === 504 ? "timeout" : `HTTP ${res.status}`;
          return keep(`error: ${what}${tries > 1 ? ` after ${tries} tries` : ""}`);
        }
        const body = (await res.json()) as GeminiResponse;
        const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
        return decideFromProbabilities(ctx, "gemini", toProbabilities(text));
      } catch (e) {
        return keep(`error: ${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message}`);
      }
    },
  };
}
