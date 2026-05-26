#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WATCH_LOG="artifacts/full_audit_campaign/generic_product_watch.log"
mkdir -p "$(dirname "$WATCH_LOG")" artifacts/launch_logs
log(){ printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$WATCH_LOG"; }
active_run(){ ps -eo args | grep -E 'node (scripts/)?full-audit-campaign-(launch|persistent-runner|worker-100-agent)\.mjs' | grep -v grep >/dev/null; }
status_field(){ python3 - "$1" <<'PY'
import json, pathlib, sys
p=pathlib.Path('artifacts/full_audit_campaign/completion_summary.json')
if not p.exists(): print(''); raise SystemExit
try: data=json.loads(p.read_text())
except Exception: print(''); raise SystemExit
key=sys.argv[1]
print(data.get(key,'') or '')
PY
}
zero_work(){ python3 - <<'PY'
import json, pathlib
p=pathlib.Path('artifacts/full_audit_campaign/completion_summary.json')
if not p.exists(): raise SystemExit(1)
data=json.loads(p.read_text())
pt=data.get('productThroughput') or data.get('requestedOutcome',{}).get('blocker',{}).get('productThroughput') or {}
raise SystemExit(0 if pt.get('zeroWork') is True else 1)
PY
}
launch_generic(){
  stamp=$(date -u +%Y%m%d-%H%M%S)
  run_id="campaign-${stamp}-mailchimp-generic-product-orchestration-watch"
  launch_log="artifacts/launch_logs/${run_id}.log"
  log "relaunching generic product orchestration run_id=${run_id}"
  env \
    MAILCHIMP_FULL_AUDIT_RUN_ID="$run_id" \
    MAILCHIMP_CAMPAIGN_RUN_ID="$run_id" \
    ORCHESTRATOR_IMPLEMENTATION_PROFILE=mailchimp_parity_focus \
    ORCHESTRATOR_REQUESTED_FIDELITY=production_slice \
    MAILCHIMP_PRODUCT_ONLY=1 \
    MAILCHIMP_USE_STRICT_GAP_INVENTORY=0 \
    MAILCHIMP_USE_BENCHMARK_SCOPE=1 \
    MAILCHIMP_CONTRACT_SCOPE_PARALLEL_ALL=1 \
    MAILCHIMP_BENCHMARK_CARRY_COMPLETED_FOCUS_IDS=1 \
    MAILCHIMP_ONE_PASS_CONTRACT_PATH=artifacts/full_audit_campaign/one_pass_run_contract.latest.json \
    MAILCHIMP_COMPLETED_FOCUS_IDS= \
    MAILCHIMP_EXCLUDED_FOCUS_IDS= \
    MAILCHIMP_REMOTE_EXECUTION=1 \
    MAILCHIMP_REMOTE_HOST=10.0.0.52 \
    MAILCHIMP_REMOTE_USER=jake \
    MAILCHIMP_REMOTE_ROOT=/home/jake/clawd-remote \
    MAILCHIMP_PERSISTENT_MAX_RUNTIME_HOURS=6 \
    MAILCHIMP_NO_PROGRESS_ITERATION_LIMIT=3 \
    node scripts/full-audit-campaign-launch.mjs >>"$launch_log" 2>&1 &
  log "started pid=$! log=${launch_log}"
}
log "watcher started"
while true; do
  if active_run; then
    log "runner active"
    sleep 120
    continue
  fi
  supervisorStatus=$(status_field supervisorStatus)
  matrixStatus=$(status_field matrixStatus)
  blockerKind=$(status_field blockerKind)
  headline=$(status_field headline)
  log "runner idle supervisor=${supervisorStatus:-unknown} matrix=${matrixStatus:-unknown} blockerKind=${blockerKind:-none} headline=${headline:-none}"
  if [[ "$blockerKind" == "zero_work_scoped_green" ]] || zero_work; then
    log "zero-work or scoped-green detected; relaunching with broad generic product scope"
    launch_generic
    sleep 180
    continue
  fi
  if [[ "$supervisorStatus" == "red" || "$supervisorStatus" == "" ]]; then
    log "red/unknown terminal status; relaunching generic product scope rather than stopping"
    launch_generic
    sleep 180
    continue
  fi
  log "terminal status not auto-relaunchable; watcher will keep checking"
  sleep 300
done
