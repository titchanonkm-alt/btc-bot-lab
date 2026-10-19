import { ema, rsi } from "../indicators.js";
import type { Fetcher } from "../prices/sources.js";
import type { Arm, ArmContext, Decision } from "../types.js";

/** Decision models on AI Gateway that answer the same question through the same endpoint. */
export const DECISION_MODELS = {
  jev: "typesafe-ai/jev",
  decision1: "microsoft/microsoft-decision-1",
} as const;

export const JEV = {
  model: DECISION_MODELS.jev,
  endpoint: "https://ai-gateway.vercel.sh/v1/evaluate",
  candlesShown: 32, // 8 hours of 15-minute candles
  threshold: 0.6,
  timeoutMs: 10_000,
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
}): Arm {
  const id = opts.id ?? "jev";
  const model = DECISION_MODELS[id];
  return {
    id,
    async decide(ctx): Promise<Decision> {
      const current = ctx.holding ? "asset" : "cash";
      const keep = (reason: string): Decision => ({ target: current, reason, state: ctx.state });
      if (!opts.apiKey) return keep("error: AI_GATEWAY_API_KEY not set");
      try {
        const res = await opts.fetcher(JEV.endpoint, {
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
        const probs = body.answers?.position?.probabilities;
        const other = current === "asset" ? "cash" : "asset";
        const pOther = probs?.[other];
        if (typeof pOther !== "number") return keep("error: no probabilities in response");
        const pct = Math.round(pOther * 100);
        if (pOther >= JEV.threshold) {
          const state: Record<string, number> = other === "asset" ? { entry: ctx.candles.at(-1)!.c } : {};
          return { target: other, reason: `${id} ${other} ${pct}%`, state };
        }
        return keep(`${id} ${other} ${pct}% < 60%`);
      } catch (e) {
        return keep(`error: ${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message}`);
      }
    },
  };
}
