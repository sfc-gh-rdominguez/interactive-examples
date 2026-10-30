USE ROLE IA_LAB_RL;
USE WAREHOUSE IA_LAB_IWH;
USE SCHEMA IA_LAB.KAFKA_STREAMING;

-- Ground truth: every ingested version vs. distinct logical events
SELECT COUNT(*) AS versions,
       COUNT(DISTINCT tenant_id || ':' || event_id) AS logical_events
FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_ALL;

-- Deduped views
SELECT 'LATEST_DEDUP' AS mode, COUNT(*) AS row_count FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_DEDUP
UNION ALL
SELECT 'LAST_DEDUP',           COUNT(*)         FROM AUDIT_EVENTS DEDUP_OPTION = LAST_DEDUP;

-- Spot check: all versions of one duplicated key, and the winner
WITH dup AS (
  SELECT tenant_id, event_id FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_ALL
  GROUP BY 1, 2 HAVING COUNT(*) > 1 LIMIT 1
)
SELECT 'version' AS kind, a.source_system, a.source_egress_ts
FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_ALL a JOIN dup USING (tenant_id, event_id)
UNION ALL
SELECT 'winner', w.source_system, w.source_egress_ts
FROM AUDIT_EVENTS DEDUP_OPTION = LATEST_DEDUP w JOIN dup USING (tenant_id, event_id)
ORDER BY kind DESC, source_egress_ts;
