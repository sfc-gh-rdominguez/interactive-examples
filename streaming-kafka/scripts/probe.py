"""Measure egress -> visible latency on the interactive warehouse."""

import argparse, json, os, statistics, time, uuid
from datetime import datetime, timezone
import snowflake.connector
from confluent_kafka import Producer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dedup",
        choices=["LATEST_DEDUP", "LAST_DEDUP", "LATEST_ALL"],
        default="LATEST_DEDUP",
    )
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--timeout", type=float, default=300)
    a = ap.parse_args()
    # DEDUP_OPTION comes only from argparse choices; the event id is bound.
    sql = (
        f"SELECT COUNT(*) FROM AUDIT_EVENTS DEDUP_OPTION = {a.dedup} "
        "WHERE tenant_id = 'probe' AND event_id = %s"
    )

    e = os.environ
    conn = snowflake.connector.connect(
        account=e["SF_ACCOUNT"],
        user=e["SF_SVC_USER"],
        private_key_file=e["SF_PRIVATE_KEY_PATH"],
        role=e["SF_ROLE"],
        warehouse=e["SF_IWH"],
        database=e["SF_DB"],
        schema=e["SF_SCHEMA"],
    )
    cur = conn.cursor()
    p = Producer({"bootstrap.servers": e.get("KAFKA_BOOTSTRAP", "localhost:9092"), "linger.ms": 0})
    topic = e.get("KAFKA_TOPIC", "audit_events")
    results = []
    for i in range(a.runs):
        eid = uuid.uuid4().hex
        ts = (
            datetime.now(timezone.utc)
            .replace(tzinfo=None)
            .strftime("%Y-%m-%dT%H:%M:%S.%f")
        )
        ev = {
            "tenant_id": "probe",
            "source_system": "probe",
            "event_id": eid,
            "event_ts": ts,
            "actor_id": "probe",
            "action": "probe",
            "resource": "probe",
            "payload": {},
            "source_egress_ts": ts,
            "kafka_produce_ts": ts,
        }
        t0 = time.monotonic()
        p.produce(topic, key=f"probe:{eid}", value=json.dumps(ev))
        p.flush()
        while True:
            cur.execute(sql, (eid,))
            if cur.fetchone()[0] > 0:
                results.append(time.monotonic() - t0)
                break
            if time.monotonic() - t0 > a.timeout:
                results.append(float("inf"))
                break
            time.sleep(0.25)
        r = results[-1]
        print(f"run {i + 1}: " + (f"{r:.2f}s" if r != float("inf") else f"timed out (>{a.timeout:.0f}s)"))
    finite = [r for r in results if r != float("inf")]
    if finite:
        print(
            f"{a.dedup}: min {min(finite):.2f}s  "
            f"median {statistics.median(finite):.2f}s  max {max(finite):.2f}s"
        )
    else:
        print(f"{a.dedup}: no run finished within {a.timeout:.0f}s")
    conn.close()


if __name__ == "__main__":
    main()
