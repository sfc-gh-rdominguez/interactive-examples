"""Synthetic multi-tenant audit-event producer. All data is generated."""

import argparse, json, os, random, time, uuid
from datetime import datetime, timedelta, timezone
from confluent_kafka import Producer

ACTIONS = ["login", "logout", "read", "write", "delete", "share", "grant", "revoke"]
SOURCES = ["idp", "saas_app", "cloud_audit"]
TOPIC = os.environ.get("KAFKA_TOPIC", "audit_events")


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def fmt(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")


def new_event(tenant):
    t = now()
    return {
        "tenant_id": tenant,
        "source_system": random.choice(SOURCES),
        "event_id": uuid.uuid4().hex,
        "event_ts": fmt(t - timedelta(seconds=random.randint(0, 300))),
        "actor_id": f"actor-{random.randint(1, 500)}",
        "action": random.choice(ACTIONS),
        "resource": f"res-{random.randint(1, 2000)}",
        "payload": {
            "ip": f"10.0.{random.randint(0, 255)}.{random.randint(0, 255)}",
            "ok": random.random() > 0.05,
        },
    }


def send(producer, ev):
    ev = dict(ev, source_egress_ts=fmt(now()))  # "fetched from source" now
    ev["kafka_produce_ts"] = fmt(now())  # handed to Kafka now
    producer.produce(
        TOPIC, key=f"{ev['tenant_id']}:{ev['event_id']}", value=json.dumps(ev)
    )
    producer.poll(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=1000)
    ap.add_argument("--tenants", type=int, default=20)
    ap.add_argument(
        "--dup-rate", type=float, default=0.0, help="fraction re-fetched later"
    )
    ap.add_argument("--rate", type=float, default=200, help="events/sec")
    a = ap.parse_args()

    p = Producer({"bootstrap.servers": os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092"), "linger.ms": 5})
    sent, recent = 0, []
    for _ in range(a.count):
        ev = new_event(f"tenant-{random.randint(1, a.tenants):04d}")
        send(p, ev)
        sent += 1
        recent.append(ev)
        recent = recent[-500:]
        if a.dup_rate and random.random() < a.dup_rate:
            # Re-fetch: same logical event, later egress, maybe via another source
            send(p, dict(random.choice(recent), source_system=random.choice(SOURCES)))
            sent += 1
        time.sleep(1 / a.rate)
    p.flush()
    print(f"sent {sent} messages ({a.count} unique events)")


if __name__ == "__main__":
    main()
