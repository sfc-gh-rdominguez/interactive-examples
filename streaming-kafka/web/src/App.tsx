import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Clock, Copy, Database, GitMerge, Layers, Radio, Search, Send, Server, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, type TargetAndTransition } from "motion/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Event, type Health, type Merge, type Mode, type Rollup } from "./api";
import { bead, button as landing, EASE, GLIDE, nod, pop, presence, rise, shake, SPRING, stage, swap } from "./motion";

const MODES: { id: Mode; label: string; help: string }[] = [
  { id: "LATEST_DEDUP", label: "Latest · deduped",
    help: "Newest row per event, deduplicated as you query. Fresh on ingest, slightly slower." },
  { id: "LAST_DEDUP", label: "Last merged",
    help: "State as of the last background merge, usually 2–5 minutes behind. Fastest, so new events appear late." },
  { id: "LATEST_ALL", label: "All versions",
    help: "Every message received, duplicates included. Fresh on ingest; the raw audit view." },
];
const TARGET_S = 60;
// Past this, the selected view isn't getting new data: nudge the user to produce some.
// Last merged normally trails the background merge by 2–5 minutes.
const STALE_S: Record<Mode, number> = { LATEST_DEDUP: 20, LATEST_ALL: 20, LAST_DEDUP: 360 };
const PRODUCE_CMD = "just produce --count 1000 --dup-rate 0.3";
// Catppuccin Mocha, mirrored from index.css for Recharts (SVG attributes don't reliably resolve CSS variables)
const CTP = { mantle: "#181825", surface1: "#45475a", overlay0: "#6c7086", overlay1: "#7f849c", text: "#cdd6f4",
              blue: "#89b4fa", sapphire: "#74c7ec", sky: "#89dceb" };
// The top actions in one cool family, then "other"
const SHADES = [CTP.blue, CTP.sapphire, CTP.sky, CTP.overlay0];
const TOP_ACTIONS = 3;
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

type Test =
  | { state: "idle" }
  | { state: "sending" | "waiting" | "done" | "timeout"; seconds: number; id?: string; run: number }
  | { state: "error"; message: string };

export default function App() {
  const [tenant, setTenant] = useState("");
  const [mode, setMode] = useState<Mode>("LATEST_DEDUP");
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [toast, setToast] = useState<React.ReactNode>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const health = usePoll(api.health, 60_000, []);
  const tenants = usePoll(api.tenants, 30_000, []);
  useEffect(() => {
    // Open on a real tenant; "probe" is where the latency script writes
    const rows = tenants.data?.rows ?? [];
    if (!tenant && rows.length) setTenant((rows.find((t) => t.TENANT !== "probe") ?? rows[0]).TENANT);
  }, [tenant, tenants.data]);

  const on = !!tenant;
  // When a test event lands, refresh the panels now rather than on the next poll
  const landed = test.state === "done" ? test.id : "";
  const events = usePoll(() => (on ? api.events(tenant, mode) : Promise.resolve(null)), 3_000, [tenant, mode, landed]);
  const fresh = usePoll(() => (on ? api.freshness(tenant, mode) : Promise.resolve(null)), 3_000, [tenant, mode, landed]);
  const merge = usePoll(() => (on ? api.merge(tenant) : Promise.resolve(null)), 5_000, [tenant, landed]);
  const rollup = usePoll(() => (on ? api.rollup(tenant, mode) : Promise.resolve(null)), 30_000, [tenant, mode]);

  // Each send gets a run number, so its progress line starts from empty instead of draining the last one
  const runs = useRef(0);
  const sendTest = useCallback(async () => {
    const run = ++runs.current;
    const t0 = performance.now();
    const secs = () => (performance.now() - t0) / 1000;
    try {
      setToast(null);
      setTest({ state: "sending", seconds: 0, run });
      const { event_id } = await api.testEvent(tenant);
      const label = MODES.find((m) => m.id === mode)!.label;
      const tick = async () => {
        const { visible } = await api.visible(tenant, event_id, mode);
        if (visible) {
          setTest({ state: "done", seconds: secs(), id: event_id, run });
          setToast(<>Queryable in <b>{secs().toFixed(2)}s</b> in <b>{label}</b>.{" "}
            {mode === "LAST_DEDUP" ? "That included waiting for a background merge."
              : <>Try <b>Last merged</b> to see how long the background merge takes.</>}</>);
        } else if (secs() > 120) {
          setTest({ state: "timeout", seconds: secs(), id: event_id, run });
          setToast(<>Not visible in <b>{label}</b> after 120s.{" "}
            {mode === "LAST_DEDUP" ? "Last merged waits for the next background merge; switch to Latest · deduped."
              : <>Check <code>just sink-status</code>.</>}</>);
        } else { setTest({ state: "waiting", seconds: secs(), id: event_id, run }); setTimeout(tick, 250); }
      };
      tick();
    } catch (e) {
      setTest({ state: "error", message: (e as Error).message });
    }
  }, [tenant, mode]);

  const busy = test.state === "sending" || test.state === "waiting";
  const current = MODES.find((m) => m.id === mode)!;
  const testId = "id" in test ? test.id : undefined;

  // Stale: no events in view, or the newest is older than this mode's threshold.
  // Wait for the first freshness poll so the notice doesn't flash on load.
  const lag = fresh.data ? fresh.data.rows[0]?.LAG_MS ?? null : undefined;
  const stale = on && lag !== undefined && (lag === null || lag / 1000 > STALE_S[mode]);
  // Dismissing hides it until data flows again and then stops again
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (!stale) setDismissed(false); }, [stale]);

  return (
    <motion.div className="app" variants={stage(0.09, 0.05)} {...presence}>
      <header>
        <motion.h1 variants={stage(0.05, 0)}>
          <motion.span variants={pop} className="word"><Activity size={22} /></motion.span>
          {"Kafka to Snowflake, in seconds".split(" ").map((w, i) => (
            <motion.span key={i} variants={pop} className="word">{w}</motion.span>
          ))}
        </motion.h1>
        <motion.p variants={pop} className="lede">
          Audit events stream from Kafka into a CDC interactive table. Duplicates are collapsed by key,
          and every event should be queryable in under {TARGET_S} seconds.
        </motion.p>
      </header>

      <motion.section className="hero" variants={stage(0.08, 0)}>
        <FreshnessStat lag={fresh.data?.rows[0]?.LAG_MS ?? null} mode={current.label} />
        <TestStat t={test} mode={current.label} />
        <DupStat m={merge.data?.rows[0]} />
      </motion.section>

      <motion.section className="toolbar" variants={pop}>
        <label className="field">
          <Layers size={16} />
          <select value={tenant} onChange={(e) => { setTenant(e.target.value); setTest({ state: "idle" }); }}>
            {tenants.data?.rows.map((t) => <option key={t.TENANT}>{t.TENANT}</option>)}
          </select>
        </label>
        <div className="mode">
          <div className="segmented">
            {MODES.map((m) => (
              <button key={m.id} className={m.id === mode ? "on" : ""} onClick={() => setMode(m.id)}>
                {m.id === mode && <motion.span layoutId="mode-pill" className="pill" transition={SPRING} />}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <Swap k={mode} as="p" className="help">{current.help}</Swap>
        </div>
        <motion.button variants={landing} className="primary" disabled={!on || busy} onClick={sendTest}
                       whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}>
          <Send size={16} /> {busy ? "Sending…" : "Send test event"}
        </motion.button>
      </motion.section>

      <motion.main className="grid" variants={stage(0.1, 0)}>
        <Card icon={<Database size={16} />} title="Live event feed"
              meta={events.data ? `${events.data.rows.length} rows · ${events.data.ms} ms` : ""} error={events.error} wide>
          <EventTable rows={events.data?.rows ?? []} testId={testId} />
        </Card>
        <Card icon={<GitMerge size={16} />} title="Deduplication" meta={merge.data ? `${merge.data.ms} ms` : ""} error={merge.error}>
          <MergePanel m={merge.data?.rows[0]} />
        </Card>
        <Card icon={<Clock size={16} />} title="Activity by hour"
              meta={rollup.data ? `${rollup.data.ms} ms` : ""} error={rollup.error}>
          <RollupChart r={rollup.data} mode={current.label} />
        </Card>
      </motion.main>

      <motion.footer variants={pop}>
        <Identity h={health.data?.rows[0]} />
        {(health.error || tenants.error) && <span className="error">{health.error ?? tenants.error}</span>}
      </motion.footer>

      <Toast onClose={closeToast}>{toast}</Toast>
      <StaleNotice open={stale && !dismissed} lag={lag ?? null} mode={current.label} onClose={() => setDismissed(true)} />
    </motion.div>
  );
}

// Bottom-right notice while the selected view is stale, with the producer command to copy
function StaleNotice({ open, lag, mode, onClose }: { open: boolean; lag: number | null; mode: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(PRODUCE_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.aside role="status" className="notice"
                      initial={{ opacity: 0, y: 24, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1, transition: GLIDE }}
                      exit={{ opacity: 0, y: 12, transition: { duration: 0.18 } }}>
          <div className="notice-head">
            <motion.span variants={bead} initial="hidden" animate="shown"><TriangleAlert size={16} /></motion.span>
            <b>No new events</b>
            <button aria-label="Dismiss" onClick={onClose}><X size={14} /></button>
          </div>
          <p>
            {lag === null ? <>Nothing in <b>{mode}</b> for this tenant yet.</>
              : <>The newest event in <b>{mode}</b> is {formatAge(lag)} old.</>}{" "}
            Start the producer from <code>streaming-kafka/</code>:
          </p>
          <div className="cmd">
            <code>{PRODUCE_CMD}</code>
            <motion.button onClick={copy} whileTap={{ scale: 0.92 }} aria-label="Copy command">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={copied ? "y" : "n"} variants={bead} {...presence}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </motion.span>
              </AnimatePresence>
              {copied ? "Copied" : "Copy"}
            </motion.button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const formatAge = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};

// Swaps its content when `k` changes: the old value leaves up, the new rises in
function Swap({ k, as = "span", className, children }: { k: React.Key; as?: "span" | "p"; className?: string; children: React.ReactNode }) {
  const M = as === "p" ? motion.p : motion.span;
  return (
    <span className="swap">
      <AnimatePresence mode="wait" initial={false}>
        <M key={k} variants={swap} {...presence} className={className}>{children}</M>
      </AnimatePresence>
    </span>
  );
}

// A short message that says what just happened and what to try next, then leaves
function Toast({ children, onClose, after = 9000 }: { children: React.ReactNode; onClose: () => void; after?: number }) {
  const open = children !== null && children !== undefined && children !== false;
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(onClose, after);
    return () => window.clearTimeout(t);
  }, [open, onClose, after, children]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div role="status" className="toast"
                    initial={{ opacity: 0, y: 24, scale: 0.96, x: "-50%" }}
                    animate={{ opacity: 1, y: 0, scale: 1, x: "-50%", transition: GLIDE }}
                    exit={{ opacity: 0, y: 12, x: "-50%", transition: { duration: 0.18 } }}>
          <div>{children}</div>
          <button aria-label="Close" onClick={onClose}><X size={14} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat(p: { label: string; value: React.ReactNode; vkey?: React.Key; caption: React.ReactNode; tone?: "ok" | "warn" | "bad";
                  react?: TargetAndTransition; reactKey?: React.Key }) {
  return (
    <motion.div className="stat" variants={pop}>
      <span className="stat-label">{p.label}</span>
      {/* Remount on reactKey so a nod or shake replays */}
      <motion.span key={p.reactKey} className={`stat-value ${p.tone ?? ""}`} animate={p.react}>
        <Swap k={p.vkey ?? String(p.value)}>{p.value}</Swap>
      </motion.span>
      <span className="stat-caption">{p.caption}</span>
    </motion.div>
  );
}

const tone = (s: number) => (s < 10 ? "ok" : s < TARGET_S ? "warn" : "bad");

function FreshnessStat({ lag, mode }: { lag: number | null; mode: string }) {
  if (lag === null) return <Stat label="Freshness" value="—" caption="No events in this view yet" />;
  const s = lag / 1000;
  return <Stat label="Freshness" value={`${s.toFixed(1)}s`} tone={tone(s)}
               caption={<>Newest event visible in <b>{mode}</b> · target under {TARGET_S}s</>} />;
}

const HOPS = [
  { label: "Sent", icon: Send },
  { label: "In Kafka", icon: Radio },
  { label: "Queryable", icon: Search },
];
const FILL_SECONDS = 0.35;

// The test event's journey as a segmented line. All or nothing: a segment fills
// only when its step is done, and the dot marks the step in progress. Segments fill one at a time:
// if several finish at once (a fast round trip), each waits for the one before.
function Hops({ reached, failed }: { reached: number; failed?: boolean }) {
  const [filled, setFilled] = useState(reached);
  useEffect(() => {
    if (filled > reached) { setFilled(reached); return; }
    if (filled === reached) return;
    const t = setTimeout(() => setFilled((f) => f + 1), FILL_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [filled, reached]);
  return (
    <ol className="hops" aria-label="Test event progress">
      {HOPS.map((h, i) => {
        const done = i < filled;
        const current = i === filled && !failed;
        const Icon = h.icon;
        return (
          <li key={h.label} className={done ? "done" : current ? "current" : failed && i === filled ? "failed" : ""}>
            <span className="hop-label">
              <motion.span className="hop-dot" animate={{ scale: done ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.3, ease: EASE }}>
                {failed && i === filled ? <X size={10} /> : <Icon size={10} />}
              </motion.span>
              {h.label}
            </span>
            <span className="hop-track">
              <motion.span initial={false} animate={{ width: done ? "100%" : "0%" }}
                           transition={{ duration: FILL_SECONDS, ease: EASE }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TestStat({ t, mode }: { t: Test; mode: string }) {
  if (t.state === "idle")
    return <Stat label="Test event" value="—" caption="Send one to time Kafka → queryable, end to end" />;
  if (t.state === "error") return <Stat label="Test event" value="Failed" tone="bad" caption={t.message} />;
  // Segments done: sending → none; in Kafka (waiting, timed out) → 2; queryable → all 3
  const reached = t.state === "sending" ? 0 : t.state === "done" ? 3 : 2;
  const value = t.state === "timeout" ? "> 120s" : t.state === "done" ? `${t.seconds.toFixed(2)}s` : `${t.seconds.toFixed(1)}s`;
  return (
    <Stat label="Test event" value={value}
          // The running timer ticks without a swap; only the final value swaps in
          vkey={t.state === "done" || t.state === "timeout" ? t.state : "running"}
          tone={t.state === "done" ? tone(t.seconds) : t.state === "timeout" ? "bad" : "warn"}
          react={t.state === "done" ? nod : t.state === "timeout" ? shake : undefined}
          reactKey={t.state === "done" || t.state === "timeout" ? `${t.id}-${t.state}` : "running"}
          caption={
            <span className="test-caption">
              <Hops key={t.run} reached={reached} failed={t.state === "timeout"} />
              <Swap k={t.state}>
                {t.state === "done" ? <><Check size={12} /> Queryable in <b>{mode}</b></>
                  : t.state === "timeout" ? <>Not visible in <b>{mode}</b> yet</>
                  : <>Waiting for <b>{mode}</b>…</>}
              </Swap>
            </span>
          } />
  );
}

function DupStat({ m }: { m?: Merge }) {
  if (!m) return <Stat label="Duplicates collapsed" value="—" caption="Waiting for data" />;
  return <Stat label="Duplicates collapsed" value={(m.VERSIONS - m.LOGICAL).toLocaleString()}
               caption={`${m.VERSIONS.toLocaleString()} messages received for ${m.LOGICAL.toLocaleString()} events`} />;
}

function Identity({ h }: { h?: Health }) {
  if (!h) return <span className="muted"><Server size={12} /> connecting…</span>;
  return <span className="muted" title="The BFF's Snowflake identity">
    <Server size={12} /> {h.USER_NAME} · {h.ROLE_NAME} · {h.WAREHOUSE_NAME}
  </span>;
}

function Card(p: { icon: React.ReactNode; title: string; meta: string; error: string | null; wide?: boolean; children: React.ReactNode }) {
  return (
    <motion.div className={`card ${p.wide ? "wide" : ""}`} variants={pop}>
      <div className="card-head"><h2>{p.icon} {p.title}</h2><span className="muted small">{p.meta}</span></div>
      {p.error ? <p className="error">{p.error}</p> : p.children}
    </motion.div>
  );
}

function EventTable({ rows, testId }: { rows: Event[]; testId?: string }) {
  if (!rows.length)
    return (
      <motion.div className="empty" variants={rise} {...presence}>
        <p>No events in the last hour for this tenant.</p>
        <p className="muted">Run <code>just produce --count 1000</code>, or click <b>Send test event</b>.</p>
      </motion.div>
    );
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Time (UTC)</th><th>Action</th><th>Actor</th><th>Resource</th><th>Source</th><th className="dim">Event</th></tr></thead>
        <tbody>
          {/* The first page doesn't animate; rows that arrive later rise in and the rest reflow */}
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const isTest = r.EVENT_ID === testId;
              return (
                <motion.tr key={`${r.EVENT_ID}-${r.EGRESS_TS}`} className={isTest ? "test" : ""}
                           layout="position" variants={rise} {...presence}>
                  <td className="mono">{hhmmss(r.EVENT_TS)}</td>
                  <td>{isTest ? <motion.span className="badge" variants={bead} {...presence}>your test event</motion.span> : r.ACTION}</td>
                  <td>{r.ACTOR}</td><td>{r.RESOURCE}</td><td>{r.SOURCE}</td>
                  <td className="mono dim">{r.EVENT_ID.slice(0, 8)}</td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

function RollupChart({ r, mode }: { r: Rollup | null; mode: string }) {
  const { data, keys } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of r?.rows ?? []) totals.set(row.ACTION, (totals.get(row.ACTION) ?? 0) + row.EVENTS);
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_ACTIONS).map(([a]) => a);
    const by = new Map<number, Record<string, number | string>>();
    for (const row of r?.rows ?? []) {
      const k = top.includes(row.ACTION) ? row.ACTION : "other";
      const o = by.get(row.HOUR) ?? { hour: hhmm(row.HOUR) };
      o[k] = ((o[k] as number) ?? 0) + row.EVENTS;
      by.set(row.HOUR, o);
    }
    const ks = totals.size > TOP_ACTIONS ? [...top, "other"] : top;
    return { data: [...by.entries()].sort(([a], [b]) => a - b).map(([, v]) => v), keys: ks };
  }, [r]);

  if (!r) return null;
  if (!data.length) return <div className="empty"><p className="muted">No events in the last 24 hours.</p></div>;
  return (
    <>
      <div className="legend">
        {keys.map((k, i) => <span key={k}><i style={{ background: SHADES[Math.min(i, SHADES.length - 1)] }} />{k}</span>)}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke={CTP.surface1} />
          <XAxis dataKey="hour" stroke={CTP.overlay1} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke={CTP.overlay1} fontSize={12} tickLine={false} axisLine={false} width={40} />
          <Tooltip cursor={{ fill: CTP.surface1 }} contentStyle={{ background: CTP.mantle, border: "none", borderRadius: 8, color: CTP.text }} />
          {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={SHADES[Math.min(i, SHADES.length - 1)]} />)}
        </BarChart>
      </ResponsiveContainer>
      <p className="muted small">
        {r.source === "mv"
          ? "From the interactive materialized view. It counts every version received, so it matches “All versions”."
          : <>Aggregated directly from <b>{mode}</b>, so the counts match the feed.</>}
      </p>
    </>
  );
}

function MergePanel({ m }: { m?: Merge }) {
  if (!m) return null;
  if (!m.VERSIONS) return <div className="empty"><p className="muted">No events yet for this tenant.</p></div>;
  const dupes = m.VERSIONS - m.LOGICAL;
  const unmerged = Math.max(m.LATEST_DEDUP - m.LAST_DEDUP, 0);
  const merging = unmerged > 0;
  const max = Math.max(m.VERSIONS, 1);
  const rows: [string, number][] = [
    ["Messages received", m.VERSIONS],
    ["Latest · deduped", m.LATEST_DEDUP],
    ["Last merged", m.LAST_DEDUP],
  ];
  return (
    <div className="merge">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={merging ? "merging" : "merged"} className={`state ${merging ? "warn" : "ok"}`} variants={bead} {...presence}>
          {merging ? "merging…" : "merged"}
        </motion.span>
      </AnimatePresence>
      <div className="facts">
        <p><b><Swap k={dupes}>{dupes.toLocaleString()}</Swap></b> duplicate messages, hidden immediately by <b>Latest · deduped</b>.</p>
        <Swap k={merging ? "merging" : "merged"} as="p">
          {merging
            ? <><b>{unmerged.toLocaleString()}</b> events not in <b>Last merged</b> yet. The background merge catches up in minutes.</>
            : <><Check size={14} /> Fully merged. All three views agree on {m.LOGICAL.toLocaleString()} events.</>}
        </Swap>
      </div>
      <div className="bars">
        {rows.map(([label, n]) => (
          <div key={label} className="bar-row">
            <span className="muted">{label}</span>
            <div className="bar"><motion.div initial={false} animate={{ width: `${(n / max) * 100}%` }} transition={SPRING} /></div>
            <span className="mono">{n.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
