# btc-bot-lab

- Results page `docs/index.html`: follow `design/DESIGN.md` for any change or new section, and compare
  with `design/reference-desktop.png` / `reference-mobile.png`. Keep the approved look.
- Settings in `src/config.ts` are locked while the count runs; changing them invalidates the comparison.
- Never put keys in the repo; runtime keys come from GitHub Secrets.
- Run `npm run typecheck && npm test` before pushing.
