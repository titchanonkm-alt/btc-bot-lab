# btc-bot-lab

- **Always plan first (Nan's standing rule):** for any task, fix or design change, send Nan an action plan and wait
  for his approval before doing it. Fixes and new designs also need a mockup or demo first.
- Results page `docs/index.html`: follow `design/DESIGN.md` for any change or new section, and compare
  with `design/reference-desktop.png` / `reference-mobile.png`. Keep the approved look.
- Settings in `src/config.ts` are locked while the count runs; changing them invalidates the comparison.
- Never put keys in the repo; runtime keys come from GitHub Secrets.
- Run `npm run typecheck && npm test` before pushing.
