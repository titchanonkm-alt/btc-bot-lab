import { ema, rsi } from "../indicators.js";
import type { Fetcher } from "../prices/sources.js";
import type { Arm, ArmContext, Decision } from "../types.js";

/** Decision models that answer the same question through the same request shape. */
export const DECISION_MODELS = {
  // OpenRouter Decisions API; version pinned so the model cannot change during the count.
  jev: "typesafe/jev-1.14",
  // Vercel AI Gateway only (needs paid Vercel credit); kept for reference, not in CONFIG.arms.
  decision1: "microsoft/microsoft-decision-1",
} as const;

export const ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/alpha/decisions",
  vercel: "https://ai-gateway.vercel.sh/v1/evaluate",
} as const;

export const JEV = {
  model: DECISION_MODELS.jev,
  endpoint: ENDPOINTS.openrouter,
  candlesShown: 32, // 8 hours of 15-minute candles
  threshold: 0.6,
  timeoutMs: 20_000,
};

/** What Jev sees: the last 8 hours, the same indicators the rule arms use, and the current position. */
export function buildState(ctx: ArmContext, asset: string) {
  const closes = ctx.candles.map((c) => c.c);
  const last = ctx.candles.at(-1)!;
  const round = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(8)) : null);
  return {
    asset,
    timeframe: "15m",
    candles: ctx.candles.slice(-JEV.candlesShown).map((c) => ({
      time: new Date(c.t).toISOString(),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      ...(c.v === null ? {} : { volume: round(c.v) }),
    })),
    indicators: {
      ema20: round(ema(closes, 20).at(-1)!),
      ema50: round(ema(closes, 50).at(-1)!),
      rsi14: round(rsi(closes, 14).at(-1)!),
    },
    position: ctx.holding
      ? {
          holding: true,
          entryPrice: ctx.state.entry ?? null,
          unrealizedPct:
            ctx.state.entry !== undefined ? round(((last.c - ctx.state.entry) / ctx.state.entry) * 100) : null,
        }
      : { holding: false },
  };
}

export const QUESTION = {
  type: "choice",
  instructions:
    "You manage a long-only position. Over the next few hours, should it hold the asset or hold cash?",
  criteria: {
    asset: "hold the asset: expect the price to rise more than trading costs",
    cash: "hold cash: expect the price to fall or move too little to cover costs",
  },
} as const;

interface EvaluateResponse {
  answers?: { position?: { choice?: string; probabilities?: Record<string, number> } };
}

/**
 * Decision-model arm (Jev or Microsoft Decision-1). Switches position only when the other side
 * has probability >= 60%. Any error or timeout keeps the current position and records why.
 */
export function makeJevArm(opts: {
  fetcher: Fetcher;
  apiKey: string | undefined;
  asset: string;
  id?: keyof typeof DECISION_MODELS;
  /** Where to send the request; Jev goes through OpenRouter, Decision-1 only exists on Vercel. */
  endpoint?: string;
  /** Name of the secret, used in the error when the key is missing. */
  keyName?: string;
}): Arm {
  const id = opts.id ?? "jev";
  const model = DECISION_MODELS[id];
  const endpoint = opts.endpoint ?? (id === "jev" ? ENDPOINTS.openrouter : ENDPOINTS.vercel);
  const keyName = opts.keyName ?? (id === "jev" ? "OPENROUTER_API_KEY" : "AI_GATEWAY_API_KEY");
  return {
    id,
    async decide(ctx): Promise<Decision> {
      const current = ctx.holding ? "asset" : "cash";
      const keep = (reason: string): Decision => ({ target: current, reason, state: ctx.state });
      if (!opts.apiKey) return keep(`error: ${keyName} not set`);
      try {
        const res = await opts.fetcher(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            state: buildState(ctx, opts.asset),
            questions: { position: QUESTION },
          }),
          signal: AbortSignal.timeout(JEV.timeoutMs),
        });
        if (!res.ok) return keep(`error: HTTP ${res.status}`);
        const body = (await res.json()) as EvaluateResponse;
        return decideFromProbabilities(ctx, id, body.answers?.position?.probabilities);
      } catch (e) {
        return keep(`error: ${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message}`);
      }
    },
  };
}

/**
 * Shared switching rule for every AI arm: move to the other side only when its probability is >= 60%,
 * otherwise keep the current position. The reason text is what appears in the Decisions tab.
 */
export function decideFromProbabilities(
  ctx: ArmContext,
  id: string,
  probs: Record<string, number> | undefined,
): Decision {
  const current = ctx.holding ? "asset" : "cash";
  const other = current === "asset" ? "cash" : "asset";
  const pOther = probs?.[other];
  if (typeof pOther !== "number" || !Number.isFinite(pOther)) {
    return { target: current, reason: "error: no probabilities in response", state: ctx.state };
  }
  const pct = Math.round(pOther * 100);
  if (pOther >= JEV.threshold) {
    const state: Record<string, number> = other === "asset" ? { entry: ctx.candles.at(-1)!.c } : {};
    return { target: other, reason: `${id} ${other} ${pct}%`, state };
  }
  return { target: current, reason: `${id} ${other} ${pct}% < 60%`, state: ctx.state };
}
