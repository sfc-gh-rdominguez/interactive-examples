USE ROLE IA_LAB_RL;
USE WAREHOUSE IA_LAB_WH;
USE SCHEMA IA_LAB.KAFKA_STREAMING;

CREATE INTERACTIVE TABLE IF NOT EXISTS AUDIT_EVENTS (
  tenant_id         VARCHAR,
  source_system     VARCHAR,
  event_id          VARCHAR,
  event_ts          TIMESTAMP_NTZ(6),
  actor_id          VARCHAR,
  action            VARCHAR,
  resource          VARCHAR,
  payload           VARIANT,
  source_egress_ts  TIMESTAMP_NTZ(6),
  kafka_produce_ts  TIMESTAMP_NTZ(6),
  CONSTRAINT pk_audit_events PRIMARY KEY (tenant_id, event_id) INITIALLY DEFERRED
)
VERSION BY source_egress_ts
ENABLE_SCHEMA_EVOLUTION = TRUE
CLUSTER BY (tenant_id, DATE_TRUNC('HOUR', event_ts));
