# btc-bot-lab

A paper-trading experiment: does an AI decision model (**Jev**) trade better than simple rules, a rule-based technical analyst, or just buying and holding?

No real money. Every trade is simulated on real market prices and logged to a Google Sheet so anyone can check the numbers.

## The six arms (per asset: BTC, gold XAU/USD, USD/THB)

| Arm | Rule |
| --- | --- |
| EMA | Hold while EMA 20 is above EMA 50 (15-minute closes) |
| RSI | Buy when RSI 14 < 30, sell when > 70 |
| Technical analyst | 1h uptrend + pullback (24h low or RSI reclaims 40) + green candle + volume, stop loss and 2R target |
| Jev (AI) | Jev decides hold/cash from the last 8 hours of candles + indicators; acts only at ≥ 60% confidence |
| Decision-1 (AI) | Same question and data as Jev, answered by Microsoft Decision-1 |
| Buy and hold | Buy once, never sell — the yardstick |

Each arm starts with 10,000 THB per asset, all-in or all-out, long only. Costs are simulated twice: with realistic costs (BTC 0.15% per side; gold and FX at observed spread) and at zero cost as a shadow column.

## Status

- [x] Indicators, paper ledger, four rule arms (tested)
- [x] Price sources: BTC from Coinbase (Kraken fallback), gold and USD/THB from Twelve Data
- [x] Jev arm via Vercel AI Gateway (`POST /v1/evaluate`)
- [x] Google Sheet log (Runs, Decisions, Trades, Equity) + State
- [x] GitHub Actions: `bot` every 15 minutes, `probe` to check every service, `test` on push
- [ ] Secrets set and probe passing
- [ ] Shakedown, then start the count

## Secrets (repository → Settings → Secrets and variables → Actions)

| Name | What |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key |
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
