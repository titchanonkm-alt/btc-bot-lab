# btc-bot-lab

A paper-trading experiment: does an AI model (**Google Gemini Flash-Lite**, free tier) trade better than simple rules, a rule-based technical analyst, or just buying and holding?

No real money. Every trade is simulated on real market prices and logged to a Google Sheet so anyone can check the numbers.

## The six arms (per asset: BTC, gold XAU/USD, USD/THB)

| Arm | Rule |
| --- | --- |
| EMA | Hold while EMA 20 is above EMA 50 (15-minute closes) |
| RSI | Buy when RSI 14 < 30, sell when > 70 |
| Technical analyst | 1h uptrend + pullback (24h low or RSI reclaims 40) + green candle + volume, stop loss and 2R target; skips setups whose target is under 3x the round-trip cost |
| Jev (AI) | TypeSafe's decision model via OpenRouter (`typesafe/jev-1.14`); same question, data and 60% rule as Gemini |
| Gemini (AI) | Gemini Flash-Lite decides hold/cash from the last 8 hours of candles + indicators; acts only at ≥ 60% confidence |
| Buy and hold | Buy once, never sell — the yardstick |

Each arm starts with 10,000 THB per asset, all-in or all-out, long only. Costs are simulated twice: with realistic costs (BTC 0.15% per side; gold and FX at observed spread) and at zero cost as a shadow column.

## Status

- [x] Indicators, paper ledger, four rule arms (tested)
- [x] Price sources: BTC from Coinbase (Kraken fallback), gold and USD/THB from Twelve Data
- [x] Gemini arm via Google AI Studio (free tier, about 500 requests/day; the bot uses 288)
- [x] Jev and Microsoft Decision-1 arms are in the code but switched off: they need paid Vercel AI Gateway credit (minimum $10)
- [x] Google Sheet log (Runs, Decisions, Trades, Equity) + State
- [x] GitHub Actions: `bot` every 15 minutes, `probe` to check every service, `test` on push
- [x] Secrets set and probe passing
- [ ] Shakedown, then start the count

## Secrets (repository → Settings → Secrets and variables → Actions)

| Name | What |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key (free) |
| `OPENROUTER_API_KEY` | OpenRouter key for Jev |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (only for Decision-1, switched off) |
| `MARKET_DATA_KEY` | Twelve Data key |
| `GOOGLE_SA_JSON` | Google service account key file (whole JSON) |
| `SHEET_ID` | The Google Sheet's id from its URL |

Run **Actions → probe → Run workflow** to check them. To start a phase, run **bot** with `reset` = `shakedown` or `count`.

## Run the tests

```bash
npm install
npm test
```

No API keys live in this repository. Runtime keys come from GitHub Secrets.

## Live results page

`docs/index.html` is published with GitHub Pages. After every run the bot rebuilds `data.json`
(see `src/site.ts`) and the workflow force-pushes it as the only file on the `data` branch;
the page reads it from there and refreshes every minute.

## Clock

GitHub's own cron is best-effort (it fired every 4-5 hours on this repo), so a Google Apps Script
(`scheduler/trigger.gs`) dispatches the `bot` workflow every 15 minutes. The cron stays as a backup.
