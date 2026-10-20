/**
 * Google Apps Script that starts the `bot` workflow every 15 minutes.
 *
 * GitHub's own cron is best-effort: on this repo it fired only every 4-5 hours.
 * A workflow_dispatch call starts a run within seconds, so this script is the real clock
 * and the cron in bot.yml stays as a backup.
 *
 * Setup (once):
 * 1. Project Settings -> Script Properties -> add GH_TOKEN = a fine-grained GitHub token
 *    for titchanonkm-alt/btc-bot-lab with "Actions: Read and write" only.
 * 2. Run installTrigger() once and approve the permissions.
 * The token never goes into this file or the repository.
 */
const REPO = "titchanonkm-alt/btc-bot-lab";
const WORKFLOW = "bot.yml";

function runBot() {
  const token = PropertiesService.getScriptProperties().getProperty("GH_TOKEN");
  if (!token) throw new Error("GH_TOKEN is not set in Script Properties");
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    payload: JSON.stringify({ ref: "main" }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 204) {
    throw new Error(`GitHub answered ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
}

function installTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === "runBot") ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger("runBot").timeBased().everyMinutes(15).create();
  runBot(); // first run now, so the setup is checked straight away
}
