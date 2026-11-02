#!/usr/bin/env bash
# One-shot build: runs every README step in order, verifying as it goes.
# Safe to re-run. Usage: just up <connection>
set -euo pipefail

C="${1:?usage: just up <connection>}"
cd "$(dirname "$0")/.."

step=""
trap 'echo; echo "✗ failed at: $step (see the matching step in README.md)"' ERR

run() { step="$1"; shift; echo; echo "▶ $step"; "$@"; }

# Poll a command until it succeeds: wait_for <label> <timeout_s> <cmd...>
wait_for() {
  local label="$1" timeout="$2"; shift 2
  local start=$SECONDS
  until "$@" >/dev/null 2>&1; do
    (( SECONDS - start > timeout )) && { echo "✗ timed out after ${timeout}s waiting for $label"; return 1; }
    sleep 5
  done
  echo "✓ $label"
}

rows() {
  snow sql -c "$C" --role IA_LAB_RL --warehouse IA_LAB_IWH --format json \
    -q "SELECT COUNT(*) AS N FROM IA_LAB.KAFKA_STREAMING.AUDIT_EVENTS DEDUP_OPTION = LATEST_ALL" \
    | jq -r '.[0].N'
}
rows_at_least() { (( $(rows) >= $1 )); }
sink_running() {
  curl -sf localhost:8083/connectors/ia-events-sink/status \
    | jq -e '.connector.state == "RUNNING" and (.tasks | length > 0) and all(.tasks[]; .state == "RUNNING")'
}

step=".env"
[[ -f .env ]] || { echo "✗ no .env: cp .env.example .env and fill it in"; exit 1; }
grep -q '^SF_ACCOUNT=myorg-myaccount$' .env && { echo "✗ set SF_ACCOUNT in .env"; exit 1; }

run "0 doctor" just doctor "$C"

step="keys"
if [[ -f keys/rsa_key.p8 ]]; then echo "· keys/rsa_key.p8 exists, keeping it"; else run "keys" just keys; fi
if [[ -f keys/dash_key.p8 ]]; then echo "· keys/dash_key.p8 exists, keeping it"; else run "dash-keys" just dash-keys; fi

run "setup"          just setup "$C"
run "service-user"   just service-user "$C"
run "check 03"       just check "$C" 03_service_user
run "events-table"   just events-table "$C"
run "iwh"            just iwh "$C"
run "check 05"       just check "$C" 05_table_ready

run "kafka-up"       just kafka-up
run "kafka-plugins"  just kafka-plugins
run "sink-add"       just sink-add
step="sink running"; wait_for "sink connector RUNNING" 180 sink_running

run "tools"          just tools

before=$(rows)
run "produce"        just produce --count 1000 --dup-rate 0.3
step="rows landed";  wait_for "events landed" 300 rows_at_least $(( before + 1000 ))
run "check 07"       just check "$C" 07_pipe
run "check 09"       just check "$C" 09_dedup

step="rollups (experiment)"; echo; echo "▶ $step"
if just rollups "$C"; then echo "✓ interactive MV created"; else echo "· interactive MV not available on this account; continuing"; fi
step="retention"; echo; echo "▶ $step"
# ADD STORAGE LIFECYCLE POLICY isn't idempotent, so only run it while the policy is absent
if snow sql -c "$C" --role IA_LAB_RL --format json -q "SHOW STORAGE LIFECYCLE POLICIES LIKE 'EXPIRE_180D' IN SCHEMA IA_LAB.KAFKA_STREAMING" | jq -e 'length > 0' >/dev/null; then
  echo "· EXPIRE_180D exists, keeping it"
else
  just retention "$C"
fi
run "check 11"       just check "$C" 11_rollups_retention

run "dashboard-user" just dashboard-user "$C"
run "check 12"       just check "$C" 12_dashboard_user
run "app-up"         just app-up
step="dashboard";    wait_for "dashboard up" 120 curl -sf localhost:8000/
has_tenants() { curl -sf localhost:8000/api/tenants | jq -e '.rows | length > 0'; }
step="dashboard data"; wait_for "dashboard sees tenants" 60 has_tenants

run "probe"          just probe --runs 1

trap - ERR
cat <<EOF

✓ Done. Dashboard: http://localhost:8000

Try next:
  just produce --count 5000 --dup-rate 0.3
  just probe-all

The interactive warehouse bills while it runs:
  just stop $C       # pause
  just teardown $C   # remove everything
EOF
