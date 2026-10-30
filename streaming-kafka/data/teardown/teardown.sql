-- Remove every Snowflake object this example creates. Safe to re-run.
USE ROLE ACCOUNTADMIN;

-- The database takes the CDC table, the materialized view, the storage lifecycle
-- policy (attached in the same schema) and the connector's default pipe with it
DROP DATABASE IF EXISTS IA_LAB;
-- Left behind if the doctor's CDC probe failed partway
DROP DATABASE IF EXISTS IA_CDC_PROBE_DB;

-- The interactive warehouse bills while it runs; drop it before anything else can resume it
DROP WAREHOUSE IF EXISTS IA_LAB_IWH;
DROP WAREHOUSE IF EXISTS IA_LAB_WH;

DROP USER IF EXISTS IA_KAFKA_SVC;
DROP USER IF EXISTS IA_DASH_SVC;

-- Dropping the roles also revokes their grants, including CREATE WAREHOUSE ON ACCOUNT
DROP ROLE IF EXISTS IA_DASH_RL;
DROP ROLE IF EXISTS IA_LAB_RL;
