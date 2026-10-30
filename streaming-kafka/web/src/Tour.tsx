import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { bead, FAST, GLIDE, presence, SPRING, swap } from "./motion";

// A guided walkthrough: the page dims, a spotlight glides between panels, and a
// card beside each one says what it is and why it matters. Clicks pass through
// the dimmed page, so the test-event step can be tried for real.

type Step = { target?: string; title: string; body: React.ReactNode };

const STEPS: Step[] = [
  {
    title: "Kafka to queryable, in seconds",
    body: (
      <>
        Audit events stream from Kafka straight into a Snowflake <b>CDC interactive table</b>, and this page reads them
        back from an <b>interactive warehouse</b>. There's no landing table, no MERGE job, and no dedup pipeline in
        between. Here's what to watch.
      </>
    ),
  },
  {
    target: "freshness",
    title: "Freshness",
    body: (
      <>
        How old the newest event a query can see is, right now. The goal is <b>under 60 seconds</b> from the source.
        With the producer running, it sits at a few seconds.
      </>
    ),
  },
  {
    target: "send",
    title: "Prove it end to end",
    body: (
      <>
        <b>Send test event</b> writes one event to Kafka and times how long until a Snowflake query returns it.
        Click it now.
      </>
    ),
  },
  {
    target: "test",
    title: "Watch it travel",
    body: (
      <>
        The line fills as the event is <b>sent</b>, <b>acknowledged by Kafka</b>, then <b>queryable</b> in Snowflake.
        The number is the whole trip, in seconds. Send another any time to time it again.
      </>
    ),
  },
  {
    target: "dupes",
    title: "Duplicates, collapsed for you",
    body: (
      <>
        Kafka delivers at least once, so the same event can arrive more than once. The table's primary key and{" "}
        <code>VERSION BY</code> column keep one row per event. Nobody writes a dedup query.
      </>
    ),
  },
  {
    target: "mode",
    title: "Three ways to read one table",
    body: (
      <>
        <b>Latest · deduped</b> dedups as you query: up-to-the-second and exact. <b>Last merged</b> has the quickest
        queries, but its data is a few minutes old, as of the last background merge. <b>All versions</b> is
        up-to-the-second too, with every duplicate left in. Every panel follows the mode you pick.
      </>
    ),
  },
  {
    target: "feed",
    title: "Served by an interactive warehouse",
    body: (
      <>
        Every row here is a live Snowflake query, re-run every few seconds. The time in the corner is how long
        Snowflake took to answer it. New events rise in at the top.
      </>
    ),
  },
  {
    target: "merge",
    title: "Watch the merge catch up",
    body: (
      <>
        Duplicates disappear from <b>Latest · deduped</b> the moment they land. <b>Last merged</b> catches up when the
        background merge runs, usually within a few minutes.
      </>
    ),
  },
  {
    target: "rollup",
    title: "Rollups",
    body: (
      <>
        Hourly counts by action. In <b>All versions</b> they come from an interactive materialized view, which counts
        every version. In the deduped modes they're aggregated directly, so they match the feed.
      </>
    ),
  },
  {
    target: "replay",
    title: "You're set",
    body: (
      <>
        If nothing is moving, run <code>just produce --count 1000 --dup-rate 0.3</code> from{" "}
        <code>streaming-kafka/</code>. You can replay this tour from here any time.
      </>
    ),
  },
];

// Remembered per browser. Storage can be missing or blocked, so every access is guarded.
const KEY = "ia-kafka-streaming.tour";
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    // Not remembered; the tour will offer itself again next visit.
  }
}

const PAD = 8;
const GAP = 14;
const CARD_W = 360;

type Box = { top: number; left: number; width: number; height: number };

// Tracks the target's viewport box, following scrolls, resizes and layout changes
function useTargetBox(target: string | undefined, open: boolean) {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!open || !target) { setBox(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (!el) { setBox(null); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    // Follow the smooth scroll as it settles
    let raf = 0;
    const until = performance.now() + 900;
    const follow = () => { measure(); if (performance.now() < until) raf = requestAnimationFrame(follow); };
    raf = requestAnimationFrame(follow);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [target, open]);
  return box;
}

// Beside the target: below if it fits, else above, else inside its top edge (tall panels)
function place(box: Box | null, cardH: number) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 32);
  if (!box) return { top: Math.max(16, (vh - cardH) / 2), left: (vw - width) / 2, width };
  const left = Math.min(Math.max(16, box.left + box.width / 2 - width / 2), vw - width - 16);
  if (box.top + box.height + GAP + cardH < vh - 16) return { top: box.top + box.height + GAP, left, width };
  if (box.top - GAP - cardH > 16) return { top: box.top - GAP - cardH, left, width };
  return { top: Math.max(16, box.top + GAP), left: Math.min(box.left + box.width - width - GAP, vw - width - 16), width };
}

const SEND = STEPS.findIndex((s) => s.target === "send");

export function Tour({ open, onClose, sent }: { open: boolean; onClose: () => void; sent: number }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const box = useTargetBox(step.target, open);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  const last = i === STEPS.length - 1;

  useEffect(() => { if (open) setI(0); }, [open]);
  // Clicking the real button on the send step moves the spotlight to the Test event card
  const sentAt = useRef(sent);
  useEffect(() => {
    if (sent !== sentAt.current && open && i === SEND) setI(SEND + 1);
    sentAt.current = sent;
  }, [sent, open, i]);
  // One size for the whole tour: the body is as tall as the tallest step, measured
  // off-screen at the card's width, so the card never resizes as it moves
  const measurer = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState<number>();
  const width = Math.min(CARD_W, window.innerWidth - 32);
  useLayoutEffect(() => {
    if (!open || !measurer.current) return;
    setBodyH(Math.max(...[...measurer.current.children].map((c) => (c as HTMLElement).offsetHeight)));
  }, [open, width]);
  useLayoutEffect(() => { if (open && card.current) setCardH(card.current.offsetHeight); }, [open, bodyH]);

  const close = useCallback(() => { markSeen(); onClose(); }, [onClose]);
  const next = useCallback(() => (last ? close() : setI((n) => n + 1)), [last, close]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, next, back]);

  const pos = place(box, cardH);
  // With no target (the welcome), the spotlight shrinks to the centre and only dims
  const spot = box ?? { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="tour" className="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: FAST }}>
          <motion.div className="tour-spot" initial={false} animate={spot} transition={SPRING} />
          <motion.div ref={card} className="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title"
                      // Enter already placed and sized; only the fade and lift animate in
                      initial={{ opacity: 0, y: 12, scale: 0.96, top: pos.top, left: pos.left, width: pos.width }}
                      animate={{ opacity: 1, y: 0, scale: 1, top: pos.top, left: pos.left, width: pos.width, transition: GLIDE }}>
            <div className="tour-head">
              <span className="tour-count">{i + 1} / {STEPS.length}</span>
              <button aria-label="Close tour" onClick={close}><X size={14} /></button>
            </div>
            <div className="tour-body" style={{ height: bodyH }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={i} variants={swap} {...presence}>
                  <h3 id="tour-title">{step.title}</h3>
                  <p>{step.body}</p>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="tour-foot">
              <div className="tour-dots" aria-hidden>
                {STEPS.map((_, n) => (
                  <motion.span key={n} variants={bead} initial="hidden" animate="shown"
                               transition={{ delay: n * 0.03 }} className={n === i ? "on" : n < i ? "seen" : ""} />
                ))}
              </div>
              {i > 0 && <button className="tour-back" onClick={back}><ArrowLeft size={14} /> Back</button>}
              <motion.button className="tour-next" onClick={next} whileTap={{ scale: 0.96 }}>
                {i === 0 ? "Show me" : last ? "Done" : "Next"} {!last && <ArrowRight size={14} />}
              </motion.button>
            </div>
            {/* Keeps its space on every step so the card's height never changes */}
            <button className="tour-skip" onClick={close} style={{ visibility: i === 0 ? "visible" : "hidden" }}
                    tabIndex={i === 0 ? 0 : -1} aria-hidden={i !== 0}>Skip the tour</button>
          </motion.div>
          {/* Every step's body at the card's inner width, invisibly, to find the tallest */}
          <div ref={measurer} className="tour-measure" aria-hidden style={{ width: width - 36 }}>
            {STEPS.map((s, n) => <div key={n}><h3>{s.title}</h3><p>{s.body}</p></div>)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
