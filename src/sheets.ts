import { createSign } from "node:crypto";
import type { Fetcher } from "./prices/sources.js";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Signed JWT for Google's OAuth token endpoint (RS256), valid one hour. */
export function serviceAccountJwt(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;
}

/** Minimal Google Sheets client over the REST API: no SDK dependency. */
export class Sheet {
  private token = "";
  constructor(
    private fetcher: Fetcher,
    private sheetId: string,
    private sa: ServiceAccount,
  ) {}

  private async auth(): Promise<string> {
    if (this.token) return this.token;
    const res = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountJwt(this.sa, Math.floor(Date.now() / 1000)),
      }),
    });
    if (!res.ok) throw new Error(`google token HTTP ${res.status}: ${await res.text()}`);
    this.token = ((await res.json()) as { access_token: string }).access_token;
    return this.token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`sheets ${path.split("?")[0]} HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Creates any missing tabs and writes their header row. */
  async ensureTabs(headers: Record<string, string[]>): Promise<void> {
    const meta = (await this.call("?fields=sheets.properties.title")) as {
      sheets: { properties: { title: string } }[];
    };
    const have = new Set(meta.sheets.map((s) => s.properties.title));
    const missing = Object.keys(headers).filter((t) => !have.has(t));
    if (!missing.length) return;
    await this.call(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    for (const t of missing) if (headers[t]!.length) await this.append(t, [headers[t]!]);
  }

  async append(tab: string, rows: (string | number)[][]): Promise<void> {
    if (!rows.length) return;
    await this.call(`/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    });
  }

  async readCell(tab: string, cell: string): Promise<string | null> {
    const body = (await this.call(`/values/${encodeURIComponent(tab)}!${cell}`)) as { values?: string[][] };
    return body.values?.[0]?.[0] ?? null;
  }

  async writeCells(tab: string, range: string, values: string[][]): Promise<void> {
    await this.call(`/values/${encodeURIComponent(tab)}!${range}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    });
  }
}
