export type Mode = "LATEST_DEDUP" | "LAST_DEDUP" | "LATEST_ALL";
export type Timed<T> = { ms: number; rows: T[] };
export type Health = { USER_NAME: string; ROLE_NAME: string; WAREHOUSE_NAME: string };
export type Event = { EVENT_TS: number; SOURCE: string; EVENT_ID: string; ACTOR: string; ACTION: string; RESOURCE: string; EGRESS_TS: number };
export type Merge = { VERSIONS: number; LOGICAL: number; LATEST_DEDUP: number; LAST_DEDUP: number };
export type Rollup = Timed<{ HOUR: number; ACTION: string; EVENTS: number }> & { source: "mv" | "direct" };

const get = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
};

export const api = {
  health: () => get<Timed<Health>>("/api/health"),
  tenants: () => get<Timed<{ TENANT: string }>>("/api/tenants"),
  events: (tenant: string, mode: Mode) => get<Timed<Event>>("/api/events", { tenant, mode, minutes: "60" }),
  freshness: (tenant: string, mode: Mode) => get<Timed<{ LAG_MS: number | null }>>("/api/freshness", { tenant, mode }),
  merge: (tenant: string) => get<Timed<Merge>>("/api/merge", { tenant }),
  rollup: (tenant: string, mode: Mode) => get<Rollup>("/api/rollup", { tenant, mode }),
  visible: (tenant: string, id: string, mode: Mode) => get<{ visible: boolean }>("/api/visible", { tenant, id, mode }),
  testEvent: async (tenant: string) => {
    const res = await fetch("/api/test-event", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return (await res.json()) as { event_id: string; tenant: string };
  },
};
