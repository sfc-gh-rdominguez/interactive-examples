import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Clock, Database, GitMerge, Layers, Send, Server, Timer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Event, type Health, type Merge, type Mode, type Rollup } from "./api";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "LATEST_DEDUP", label: "Latest · deduped", hint: "fresh on ingest, merges at query time" },
  { id: "LAST_DEDUP", label: "Last merged", hint: "fastest, lags the background merge" },
  { id: "LATEST_ALL", label: "All versions", hint: "no dedup, the audit view" },
];
const COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#2dd4bf", "#fb923c"];
const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

// Poll fn every `every` ms while deps are stable; returns the latest result
function usePoll<T>(fn: () => Promise<T>, every: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const run = () => fn().then((d) => { if (live) { setData(d); setError(null); } })
                          .catch((e: Error) => live && setError(e.message));
    run();
    const id = setInterval(run, every);
    return () => { live = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

type Test = { state: "idle" } | { state: "waiting" | "done" | "timeout"; seconds: number } | { state: "error"; message: string };

export default function App() {
  const [tenant, setTenant] = useState("");
  const [mode, setMode] = useState<Mode>("LATEST_DEDUP");
  const [test, setTest] = useState<Test>({ state: "idle" });

  const health = usePoll(api.health, 60_000, []);
  const tenants = usePoll(api.tenants, 30_000, []);
  useEffect(() => {
    if (!tenant && tenants.data?.rows.length) setTenant(tenants.data.rows[0].TENANT);
  }, [tenant, tenants.data]);

  const on = !!tenant;
  const events = usePoll(() => (on ? api.events(tenant, mode) : Promise.resolve(null)), 3_000, [tenant, mode]);
  const fresh = usePoll(() => (on ? api.freshness(tenant, mode) : Promise.resolve(null)), 3_000, [tenant, mode]);
  const merge = usePoll(() => (on ? api.merge(tenant) : Promise.resolve(null)), 5_000, [tenant]);
  const rollup = usePoll(() => (on ? api.rollup(tenant) : Promise.resolve(null)), 30_000, [tenant]);

  const sendTest = useCallback(async () => {
    const t0 = performance.now();
    const secs = () => (performance.now() - t0) / 1000;
    try {
      setTest({ state: "waiting", seconds: 0 });
      const { event_id } = await api.testEvent(tenant);
      const tick = async () => {
        const { visible } = await api.visible(tenant, event_id, mode);
        if (visible) setTest({ state: "done", seconds: secs() });
        else if (secs() > 120) setTest({ state: "timeout", seconds: secs() });
        else { setTest({ state: "waiting", seconds: secs() }); setTimeout(tick, 250); }
      };
      tick();
    } catch (e) {
      setTest({ state: "error", message: (e as Error).message });
    }
  }, [tenant, mode]);

  return (
    <div className="app">
      <header>
        <div className="title"><Activity size={20} /> Audit events <span className="muted">interactive analytics</span></div>
        <Identity h={health.data?.rows[0]} />
      </header>

      <section className="toolbar">
        <label className="field">
          <Layers size={16} />
          <select value={tenant} onChange={(e) => { setTenant(e.target.value); setTest({ state: "idle" }); }}>
            {tenants.data?.rows.map((t) => <option key={t.TENANT}>{t.TENANT}</option>)}
          </select>
        </label>
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m.id} title={m.hint} className={m.id === mode ? "on" : ""} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <Freshness lag={fresh.data?.rows[0]?.LAG_MS ?? null} />
        <button className="primary" disabled={!on || test.state === "waiting"} onClick={sendTest}>
          <Send size={16} /> Send test event
        </button>
        <TestResult t={test} mode={mode} />
      </section>

      <main className="grid">
        <Card icon={<Database size={16} />} title="Event feed" meta={events.data ? `${events.data.rows.length} rows · ${events.data.ms} ms` : ""} error={events.error} wide>
          <EventTable rows={events.data?.rows ?? []} />
        </Card>
        <Card icon={<Clock size={16} />} title="Activity by hour" meta={rollup.data ? `${rollup.data.source === "mv" ? "interactive MV" : "direct aggregate"} · ${rollup.data.ms} ms` : ""} error={rollup.error}>
          <RollupChart r={rollup.data} />
        </Card>
        <Card icon={<GitMerge size={16} />} title="Dedup & merge" meta={merge.data ? `${merge.data.ms} ms` : ""} error={merge.error}>
          <MergePanel m={merge.data?.rows[0]} />
        </Card>
      </main>
      {(health.error || tenants.error) && <p className="error">{health.error ?? tenants.error}</p>}
    </div>
  );
}

function Identity({ h }: { h?: Health }) {
  if (!h) return <span className="chip muted"><Server size={14} /> connecting…</span>;
  return <span className="chip"><Server size={14} /> {h.USER_NAME} · {h.ROLE_NAME} · {h.WAREHOUSE_NAME}</span>;
}

function Freshness({ lag }: { lag: number | null }) {
  if (lag === null) return <span className="chip muted"><Timer size={14} /> no recent events</span>;
  const s = lag / 1000;
  const cls = s < 10 ? "ok" : s < 60 ? "warn" : "bad";
  return <span className={`chip ${cls}`} title="now − newest visible source_egress_ts"><Timer size={14} /> newest event {s.toFixed(1)}s ago</span>;
}

function TestResult({ t, mode }: { t: Test; mode: Mode }) {
  if (t.state === "idle") return null;
  if (t.state === "error") return <span className="chip bad">{t.message}</span>;
  const cls = t.state === "done" ? (t.seconds < 60 ? "ok" : "bad") : t.state === "timeout" ? "bad" : "warn";
  const label = t.state === "done" ? `visible in ${t.seconds.toFixed(2)}s` : t.state === "timeout" ? "not visible after 120s" : `waiting… ${t.seconds.toFixed(1)}s`;
  return <span className={`chip ${cls}`}>{label} <span className="muted">({mode})</span></span>;
}

function Card(p: { icon: React.ReactNode; title: string; meta: string; error: string | null; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`card ${p.wide ? "wide" : ""}`}>
      <div className="card-head"><span>{p.icon} {p.title}</span><span className="muted">{p.meta}</span></div>
      {p.error ? <p className="error">{p.error}</p> : p.children}
    </div>
  );
}

function EventTable({ rows }: { rows: Event[] }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>event_ts</th><th>action</th><th>actor</th><th>resource</th><th>source</th><th>egress</th><th>event_id</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.EVENT_ID}-${r.EGRESS_TS}`} className={r.ACTION === "test" ? "hl" : ""}>
              <td>{hhmmss(r.EVENT_TS)}</td><td>{r.ACTION}</td><td>{r.ACTOR}</td><td>{r.RESOURCE}</td>
              <td>{r.SOURCE}</td><td>{hhmmss(r.EGRESS_TS)}</td><td className="mono">{r.EVENT_ID.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RollupChart({ r }: { r: Rollup | null }) {
  const { data, actions } = useMemo(() => {
    const by = new Map<number, Record<string, number | string>>();
    const acts = new Set<string>();
    for (const row of r?.rows ?? []) {
      acts.add(row.ACTION);
      const o = by.get(row.HOUR) ?? { hour: hhmm(row.HOUR) };
      o[row.ACTION] = row.EVENTS;
      by.set(row.HOUR, o);
    }
    return { data: [...by.entries()].sort(([a], [b]) => a - b).map(([, v]) => v), actions: [...acts].sort() };
  }, [r]);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="hour" stroke="#94a3b8" fontSize={12} />
        <YAxis stroke="#94a3b8" fontSize={12} />
        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {actions.map((a, i) => <Bar key={a} dataKey={a} stackId="a" fill={COLORS[i % COLORS.length]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function MergePanel({ m }: { m?: Merge }) {
  if (!m) return null;
  const max = Math.max(m.VERSIONS, 1);
  const rows: [string, number, string][] = [
    ["All versions (LATEST_ALL)", m.VERSIONS, "every ingested message"],
    ["Logical events", m.LOGICAL, "distinct event_id"],
    ["LATEST_DEDUP", m.LATEST_DEDUP, "should equal logical"],
    ["LAST_DEDUP", m.LAST_DEDUP, "converges as merge runs"],
  ];
  return (
    <div className="bars">
      {rows.map(([label, n, hint]) => (
        <div key={label} className="bar-row" title={hint}>
          <span>{label}</span>
          <div className="bar"><div style={{ width: `${(n / max) * 100}%` }} /></div>
          <span className="mono">{n.toLocaleString()}</span>
        </div>
      ))}
      <p className="muted small">{m.VERSIONS - m.LOGICAL} duplicates collapsed · {m.LOGICAL === m.LATEST_DEDUP ? "✓ dedup exact" : "⚠ dedup mismatch"}</p>
    </div>
  );
}
