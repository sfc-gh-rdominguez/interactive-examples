#!/usr/bin/env bash

# Use just sink-add!
set -euo pipefail
NAME="ia-events-sink"
TABLE="AUDIT_EVENTS"
jq -n \
  --arg topic "$KAFKA_TOPIC" --arg table "$TABLE" \
  --arg url "${SF_ACCOUNT}.snowflakecomputing.com:443" \
  --arg user "$SF_SVC_USER" --arg role "$SF_ROLE" --arg db "$SF_DB" \
  --arg schema "$SF_SCHEMA" --arg wh "$SF_WH" \
  --arg key "$(grep -v -- '-----' "$SF_PRIVATE_KEY_PATH" | tr -d '\n')" \
  '{
    "connector.class": "com.snowflake.kafka.connector.SnowflakeStreamingSinkConnector",
    "tasks.max": "3",
    "topics": $topic,
    "snowflake.topic2table.map": ($topic + ":" + $table),
    "snowflake.url.name": $url,
    "snowflake.user.name": $user,
    "snowflake.private.key": $key,
    "snowflake.role.name": $role,
    "snowflake.database.name": $db,
    "snowflake.schema.name": $schema,
    "snowflake.warehouse.name": $wh,
    "snowflake.ingestion.method": "SNOWPIPE_STREAMING",
    "snowflake.streaming.v2.enabled": "true",
    "snowflake.streaming.enable.altering.target.pipes.tables": "false",
    "snowflake.enable.schematization": "true",
    "snowflake.streaming.validate.compatibility.with.classic": "false",
    "key.converter": "org.apache.kafka.connect.storage.StringConverter",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false",
    "errors.tolerance": "all",
    "errors.log.enable": "true"
  }' |
  curl -s -X PUT "localhost:8083/connectors/${NAME}/config" \
    -H 'Content-Type: application/json' -d @- | jq '{name, type}'
