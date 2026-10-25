# Results page — design reference

The look of `docs/index.html` as approved by Nan on 21 Oct 2026. Any change or new section must keep
this look. Reference screenshots: `reference-desktop.png`, `reference-mobile.png` (simulated data).

**Spirit:** a calm, plain dashboard that a non-trader understands at a glance (layout modelled on the
Jex bot page): big numbers, few words, white cards on a warm grey page, colour only where it carries
meaning (up/down, which arm).

## Layout

- Max width 1400px, 16px page padding, 16px gap everywhere.
- Top bar, one row: brand (orange "AI" square + "AI vs กฎง่ายๆ") → asset tabs (segmented control,
  coloured dot per asset) → right side: phase badge, status pill ("ทำงานอยู่" / "หยุดอัปเดต"), "อัปเดต … ที่แล้ว".
- Desktop grid, 2 columns (2.1fr / 1fr):

  | left | right |
  | --- | --- |
  | price card | "now" card |
  | equity card | trades card |
  | equity card | overview card |

- Mobile (≤ 900px), one column in this order: equity → now → price → trades → overview.
- **Asset-switch motion** (tabs and swipes alike): a sideways page swipe. While dragging, the cards follow the
  finger (rubber band at 25% past the first/last asset). Release past 70px or flicked faster than 0.5px/ms: the
  page moves 60% of its width away and fades in 170 ms, then the next asset slides in from the opposite side
  over 420 ms, cubic-bezier(.22,1,.36,1), its rows fading in 22 ms apart. Otherwise it springs back in 300 ms.
  The top bar stays still. Reduced-motion users get an instant switch.
- **Live BTC:** the page reads Coinbase's public ticker; on the BTC tab the big price, 24 h change, the forming
  candle and the equity of arms holding BTC follow it each second, marked by a green "ราคาสด" pill and
  a blinking green dot before "กำไร/ขาดทุน" in the board header. Display only; the bot and the equity chart use closed candles.
  Gold and USD/THB stay on 15-minute data.
- Swiping left/right anywhere on the page switches asset (BTC → ทองคำ → USD/THB, no wrap) with the asset-switch
  motion below; swipes that start on the tabs, range toggle or marker chips are ignored.
- New sections are new cards in this grid. Never full-bleed bands, never a hero section.

## Tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` page | `#f3f2ee` | `#0e0f11` |
| `--card` | `#ffffff` | `#16171a` |
| `--line` borders/dividers | `#e6e4dd` | `#26282c` |
| `--soft` controls, tags | `#f6f5f1` | `#1c1d21` |
| `--ink` text | `#15140f` | `#ecebe6` |
| `--dim` secondary text | `#7c796f` | `#8d8c86` |
| `--up` / `--up-bg` | `#0f9d6b` / `#e3f5ec` | `#3ccf91` / `#12301f` |
| `--down` / `--down-bg` | `#e0413a` / `#fde8e6` | `#ff6b5f` / `#3a1714` |
| `--hot` accent | `#ff5b1f` | `#ff5b1f` |

Arm colours (same arm = same colour everywhere: dots, lines, markers, names):
`gemini #ff5b1f` · `jev #0f9f94` (dark `#2dd4bf`) · `ema #1f8fcf` (dark `#4cc9f0`) · `rsi #8a63e8` (dark `#b59bff`) ·
`ta #d79a00` (dark `#ffd166`) · `hold #8c8a82` (dark `#a3a29a`).
Asset dots: BTC `#f7931a` · gold `#d4a72c` · USD/THB `#2e7d5b`.

Dark mode follows the system setting (`prefers-color-scheme`); light is the default.

## Type

- Text: **IBM Plex Sans Thai** (400/500/600/700). Numbers, prices, times, percentages: **IBM Plex Mono**
  with tabular figures (`.num`).
- Sizes: headline price 36–52px/600 · equity leader line 22px/700 · card title 15px/600 ·
  body 14px · secondary 12–13px in `--dim`.
- Thai copy, short and plain ("ถือ", "เงินสด", "รอก่อน", "นำอยู่"). Arm reasons from the bot may stay in English.

## Components

- **Card:** `--card`, 1px `--line` border, radius 16px, padding 20px 22px, no shadow.
- **Segmented control** (asset tabs, range toggle): `--soft` track, radius 10px; selected = card colour,
  weight 600, tiny shadow `0 1px 2px rgba(0,0,0,.08)`.
- **Status pill:** rounded 999px, dot before the text (green = live, red = stale > 45 min).
- **Phase badge:** solid orange "ทดลองระบบ · ยังไม่นับ" / solid green "นับผลจริง".
- **Tag:** small radius-5 label; "ถือ" uses `--up-bg`/`--up`, "เงินสด" uses `--soft`/`--dim`.
- **P/L chip:** mono, radius 6, `--up-bg`/`--down-bg` background with matching text, sign `+` / `−`.
- **Arm marker:** 10px rounded square in the arm colour before the arm name.
- **"AI คิดว่า" box:** soft orange→violet gradient, radius 12; one small label + one bold line per AI arm
  (Gemini, Jev), each with a dot in the arm colour.
- Rows inside cards are separated by 1px `--line` top borders, never zebra stripes.
- **Leader line** (equity card): name a leader only when one arm is strictly ahead and above 0%; otherwise
  say "ยังเสมอกันทุกสาย", "เสมอกัน N สาย", "… ยังไม่ขาดทุน · สายอื่นติดลบ" or "ติดลบทุกสาย · … เสียน้อยสุด".
- **Leaderboard** (equity card): small dim header row, columns rank · arm · ถือ/เงินสด tag · เงินในพอร์ต ·
  กำไร/ขาดทุน · ร่วงหนักสุด (max drawdown, red when below 0) · เทรด (count). On mobile the เงินในพอร์ต column hides.

## Charts

- Library: TradingView **lightweight-charts 4.2.0** (standalone, unpkg). Keep its attribution logo.
- Shared options: transparent background, no vertical grid, horizontal grid in `--line`, no axis
  borders, mono 11px axis text in `--dim`, no scroll/zoom, `localization.locale = "th-TH"`.
- Times are shown in Thai time by adding 7 h to UTC seconds (`TH_OFFSET`).
- **Price chart:** 15-minute candlesticks, `--up`/`--down`, no borders, height 300px (260 mobile).
  Buy = green up-arrow below the bar labelled "ซื้อ"; sell = red down-arrow above, "ขาย"; one arm at a time,
  chosen with chips under the chart (default Gemini).
- **Equity chart:** one line per arm in its colour, AI arms (Gemini, Jev) 3px, others 2px, buy-and-hold dashed grey;
  no last-value labels; THB price formatter `฿10,000`; height 230px.

## Numbers

- Prices: BTC and gold 2 decimals, USD/THB 3, thousands separators.
- Money: `฿9,914` (no decimals). Returns: `+0.67%` / `−1.56%` with a true minus sign, coloured up/down,
  grey at exactly 0.
- Times: 24-hour Thai time `08:30`; dates `18 ต.ค.`.

## Do / don't

- Do keep the footer disclaimer ("ผลที่ผ่านมาไม่ได้รับประกันผลในอนาคต · ไม่ใช่คำแนะนำการลงทุน") and the
  AI answer-rate figure (one line per AI arm).
- Do keep everything in one HTML file with inline CSS/JS; only external resources are Google Fonts and
  lightweight-charts.
- Don't add new colours for decoration, heavy shadows, gradients other than the AI box, emoji, or icons
  beyond the coloured dots.
- Don't use another site's name, logo or text.
