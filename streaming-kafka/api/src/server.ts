import { Elysia } from "elysia";
import { Kafka } from "kafkajs";
import { query } from "./db";

const port = Number(process.env.SERVER_PORT) || 8001;
const MODES = ["LATEST_DEDUP", "LAST_DEDUP", "LATEST_ALL"] as const;

// Allowlist everything that ends up in SQL text; everything else is a bind
const mode = (m: unknown) => (MODES as readonly string[]).includes(String(m)) ? String(m) : "LATEST_DEDUP";
const tenant = (t: unknown) => {
  const s = String(t ?? "");
  if (!/^[a-z0-9-]{1,64}$/.test(s)) throw new Error("bad tenant");
  return s;
};
const clamp = (n: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Number(n) || d));
const timed = async <T>(p: Promise<T>) => { const t0 = performance.now(); const rows = await p; return { ms: Math.round(performance.now() - t0), rows }; };
const ntz = () => new Date().toISOString().replace("Z", "").padEnd(26, "0"); // TIMESTAMP_NTZ(6), UTC

// Kafka is write-only here (the test-event button); reads all go to Snowflake.
// Connect on first use so a missing broker can't block API startup.
const producer = new Kafka({ clientId: "ia-dashboard", brokers: (process.env.KAFKA_BROKERS ?? "kafka:29092").split(",") }).producer();
let connected: Promise<void> | null = null;
const produce = async (key: string, value: object) => {
  connected ??= producer.connect();
  await connected;
  await producer.send({ topic: process.env.KAFKA_TOPIC ?? "audit_events", messages: [{ key, value: JSON.stringify(value) }] });
};

new Elysia()
  .onError(({ error, set }) => {
    const msg = error instanceof Error ? error.message : String(error);
    set.status = msg === "bad tenant" ? 400 : 500;
    return { error: msg };
  })
  .get("/healthcheck", () => "ok")
  .get("/api/health", () =>
    timed(query("SELECT CURRENT_USER() AS USER_NAME, CURRENT_ROLE() AS ROLE_NAME, CURRENT_WAREHOUSE() AS WAREHOUSE_NAME")))
  .get("/api/tenants", () =>
    timed(query(`SELECT DISTINCT tenant_id AS TENANT FROM AUDIT_EVENTS DEDUP_OPTION = LAST_DEDUP
                 WHERE event_ts >= DATEADD(hour, -24, SYSDATE()) ORDER BY 1 LIMIT 200`)))
  .get("/api/events", ({ query: q }) =>
    timed(query(`SELECT event_ts AS EVENT_TS, source_system AS SOURCE, event_id AS EVENT_ID, actor_id AS ACTOR,
                        action AS ACTION, resource AS RESOURCE, source_egress_ts AS EGRESS_TS
                 FROM AUDIT_EVENTS DEDUP_OPTION = ${mode(q.mode)}
                 WHERE tenant_id = ? AND event_ts >= DATEADD(minute, -?, SYSDATE())
                 ORDER BY event_ts DESC LIMIT 100`,
      [tenant(q.tenant), clamp(q.minutes, 1, 1440, 60)])))
  .get("/api/freshness", ({ query: q }) =>
    timed(query(`SELECT DATEDIFF('millisecond', MAX(source_egress_ts), SYSDATE()) AS LAG_MS
                 FROM AUDIT_EVENTS DEDUP_OPTION = ${mode(q.mode)}
                 WHERE tenant_id = ? AND event_ts >= DATEADD(minute, -15, SYSDATE())`, [tenant(q.tenant)])))
  .get("/api/merge", ({ query: q }) =>
    // One UNION ALL branch per DEDUP_OPTION. Scalar subqueries or CTE joins in a single
    // query block were observed to apply one option to every scan of the table.
    timed(query(`SELECT MAX(IFF(k = 'v', n, NULL)) AS VERSIONS,     MAX(IFF(k = 'g', n, NULL)) AS LOGICAL,
                        MAX(IFF(k = 'd', n, NULL)) AS LATEST_DEDUP, MAX(IFF(k = 'l', n, NULL)) AS LAST_DEDUP
                 FROM (
                   SELECT 'v' AS k, COUNT(*) AS n FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_ALL WHERE tenant_id = ?
                   UNION ALL SELECT 'g', COUNT(DISTINCT event_id) FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_ALL WHERE tenant_id = ?
                   UNION ALL SELECT 'd', COUNT(*) FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_DEDUP WHERE tenant_id = ?
                   UNION ALL SELECT 'l', COUNT(*) FROM AUDIT_EVENTS DEDUP_OPTION = LAST_DEDUP WHERE tenant_id = ?
                 )`,
      Array(4).fill(tenant(q.tenant)))))
  .get("/api/rollup", async ({ query: q }) => {
    const t = tenant(q.tenant);
    const m = mode(q.mode);
    // The Step 11 MV counts every ingested version, so it only matches LATEST_ALL
    if (m === "LATEST_ALL") {
      try {
        return { source: "mv", ...(await timed(query(
          `SELECT hour AS HOUR, action AS ACTION, events AS EVENTS FROM MV_ACTIONS_BY_TENANT_HOUR
           WHERE tenant_id = ? AND hour >= DATEADD(hour, -24, SYSDATE()) ORDER BY hour`, [t]))) };
      } catch {
        // No MV (Step 11 experiment failed): fall through to the direct aggregate
      }
    }
    return { source: "direct", ...(await timed(query(
      `SELECT DATE_TRUNC('HOUR', event_ts) AS HOUR, action AS ACTION, COUNT(*) AS EVENTS
       FROM AUDIT_EVENTS DEDUP_OPTION = ${m}
       WHERE tenant_id = ? AND event_ts >= DATEADD(hour, -24, SYSDATE()) GROUP BY 1, 2 ORDER BY 1`, [t]))) };
  })
  .post("/api/test-event", async ({ body }) => {
    const t = tenant((body as { tenant?: string } | undefined)?.tenant);
    const id = crypto.randomUUID().replaceAll("-", "");
    const now = ntz();
    const ev = { tenant_id: t, source_system: "dashboard", event_id: id, event_ts: now, actor_id: "dashboard",
                 action: "test", resource: "test", payload: {}, source_egress_ts: now, kafka_produce_ts: ntz() };
    await produce(`${t}:${id}`, ev);
    return { event_id: id, tenant: t };
  })
  .get("/api/visible", async ({ query: q }) => {
    const rows = await query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM AUDIT_EVENTS DEDUP_OPTION = ${mode(q.mode)} WHERE tenant_id = ? AND event_id = ?`,
      [tenant(q.tenant), String(q.id ?? "").slice(0, 64)]);
    return { visible: (rows[0]?.N ?? 0) > 0 };
  })
  .listen(port);

console.log(`api listening on :${port}`);
