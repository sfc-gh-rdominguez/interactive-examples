import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

// Key-pair JWT for the SQL API: iss = ACCOUNT.USER.SHA256:<fp>, sub = ACCOUNT.USER (uppercase)
const ACCOUNT = process.env.SF_ACCOUNT!.toUpperCase().replace(/\./g, "-");
const USER = process.env.SF_DASH_USER!.toUpperCase();
const key = createPrivateKey(readFileSync(process.env.SF_DASH_KEY_PATH!));
const fp = "SHA256:" + createHash("sha256")
  .update(createPublicKey(key).export({ type: "spki", format: "der" }))
  .digest("base64");
const b64u = (s: string) => Buffer.from(s).toString("base64url");

let cached: { token: string; exp: number } | null = null;
const jwt = () => {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const exp = now + 59 * 60; // max lifetime is 1 hour
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: `${ACCOUNT}.${USER}.${fp}`, sub: `${ACCOUNT}.${USER}`, iat: now, exp }));
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  cached = { token: `${head}.${body}.${sig}`, exp };
  return cached.token;
};

type RowType = { name: string; type: string };
const coerce = (raw: string | null, t: string) =>
  raw === null ? null
  : t === "fixed" || t === "real" ? Number(raw)
  : t === "boolean" ? raw === "true"
  : t.startsWith("timestamp") ? Math.round(Number(raw) * 1000) // epoch ms (UTC)
  : raw;

// Positional binds (?) keep user input out of the SQL text
export const query = async <T = Record<string, unknown>>(statement: string, binds: (string | number)[] = []): Promise<T[]> => {
  const bindings = Object.fromEntries(binds.map((v, i) => [
    String(i + 1), { type: typeof v === "number" ? "FIXED" : "TEXT", value: String(v) },
  ]));
  const res = await fetch(`https://${process.env.SF_ACCOUNT}.snowflakecomputing.com/api/v2/statements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      statement, bindings, timeout: 30,
      role: process.env.SF_DASH_ROLE,
      warehouse: process.env.SF_IWH,
      database: process.env.SF_DB,
      schema: process.env.SF_SCHEMA,
    }),
  });
  if (res.status !== 200) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  const p = (await res.json()) as { resultSetMetaData?: { rowType: RowType[] }; data?: (string | null)[][] };
  const rt = p.resultSetMetaData?.rowType ?? [];
  return (p.data ?? []).map((row) => {
    const o: Record<string, unknown> = {};
    rt.forEach((c, i) => (o[c.name] = coerce(row[i] ?? null, c.type)));
    return o as T;
  });
};
