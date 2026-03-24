# Cortex Full-Level Audit Report

Generated: 2026-02-19T10:08:51.246769

Host: `10.0.0.52`  Deployment: `/opt/clawdbot` + `/app/cortex_server`

## Executive Summary

- Implemented levels observed: **38 (L1-L38)**; online from `/kernel/levels`: all marked online.
- Canonical status endpoints passing: **35/38**.
- Cross-level orchestration and contract metadata are broadly healthy (contract self-test PASS, brainstorm hard-route PASS, 404 metadata suppression PASS).
- Highest-risk regressions: canonical endpoint-map drift (L1/L9/L24), queue status hang, and alias metadata inconsistency (`/orchestrator/status` vs `/conductor/status`).

## Prioritized Findings

### P0
1. **Queue subsystem appears dead/hanging**: `GET /queue/status` times out (5s, HTTP 000). Potential dead path affecting scheduler/orchestration observability.
2. **Canonical map contract drift for critical levels**: `/meta_conductor/endpoint_map` advertises missing canonical statuses: `/kernel/status`, `/architect/status`, `/nexus/status` (all 404). This breaks level contract discovery and automation relying on canonical status pointers.
### P1
1. **Alias response contract inconsistency**: `/conductor/status` includes HUD + activated_levels, but `/orchestrator/status` omits both while still claiming activation metadata available in contract block.
2. **Role drift in level naming/mapping**: Level map variants differ across modules (`kernel/levels`, `nexus LEVEL_MAP`, and `meta_conductor endpoint_map`), increasing risk of orchestration misrouting and stale docs.
### P2
1. Some status routers return heterogeneous payload shapes (`data` wrapper vs top-level), requiring defensive clients.
2. Evidence of hygiene/remediation snapshots exists in backups; overall contract hardening improved (see fixed section).

## What Is Already Fixed / Healthy

- Contract self-test (`/contract/self-test`) fully PASS including brainstorm hard-route and 404 HUD suppression.
- SAFE_MODE is active at runtime (`CORTEX_SAFE_MODE=true`).
- Always-on/meta stack activates in orchestration path (`nexus/orchestrate` shows always-on levels plus forced brainstorm chain).
- Scheduler interactions healthy for Cron/Sentinel/Night Shift endpoints.
- 35/38 canonical status endpoints currently return 200.

## Per-Level Matrix (L1-L38)

|Lvl|Level|Endpoint(s)|Expected role|Observed behavior|Dependencies (up/down)|Support obligations|Health|Evidence|
|---:|---|---|---|---|---|---|---|---|
|1|Kernel|`/kernel/status`; /kernel/levels|Orchestration level service|status 404|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|❌|`curl /kernel/status`|
|2|Ghost (Browser)|`/browser/status`; /browser/status, /browser/browse, /browser/screenshot …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /browser/status`|
|3|Parser|`/parsers/status`; /parsers/status, /parsers/extract, /parsers/python …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /parsers/status`|
|4|Lab|`/lab/status`; /lab/execute, /lab/status|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /lab/status`|
|5|Oracle|`/oracle/status`; /oracle/chat, /oracle/ledger, /oracle/status|Orchestration level service|status 200, state=online|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /oracle/status`|
|6|Bard|`/bard/status`; /bard/status, /bard/speak, /bard/voices|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /bard/status`|
|7|Librarian|`/librarian/status`; /librarian/status, /librarian/embed, /librarian/search …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /librarian/status`|
|8|Cron|`/cron/status`; /cron/schedule, /cron/jobs, /cron/jobs/{job_id} …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /cron/status`|
|9|Architect|`/architect/status`; /meta_conductor/health, /meta_conductor/status, /meta_conductor/orchestrate …|Orchestration level service|status 404|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|❌|`curl /architect/status`|
|10|Listener|`/listener/status`; /listener/status, /listener/transcribe, /listener/analyze|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /listener/status`|
|11|Catalyst|`/catalyst/status`; /catalyst/status, /catalyst/optimize_now, /catalyst/profile …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /catalyst/status`|
|12|Hive/Darwin|`/hive/status`; /darwin/evolve, /darwin/status, /hive/swarm …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /hive/status`|
|13|Dreamer|`/dreamer/status`; /dreamer/status, /dreamer/dreams, /dreamer/dream|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /dreamer/status`|
|14|Chronos (Night Shift)|`/night_shift/status`; /chronos/status, /chronos/trigger, /night_shift/status …|Orchestration level service|status 200, state=running|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /night_shift/status`|
|15|Council|`/council/status`; /council/status, /council/deliberate, /council/critique …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /council/status`|
|16|Academy|`/academy/status`; /academy/status, /academy/learn, /academy/teach …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /academy/status`|
|17|Exoskeleton|`/tools/status`; /tools/ffmpeg/convert, /tools/ffmpeg/extract-audio, /tools/ffmpeg/thumbnail …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /tools/status`|
|18|Diplomat|`/diplomat/status`; /diplomat/send, /diplomat/broadcast, /diplomat/log …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /diplomat/status`|
|19|Geneticist|`/geneticist/status`; /geneticist/propose, /geneticist/proposal/{proposal_id}, /geneticist/apply …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /geneticist/status`|
|20|Simulator|`/simulator/status`; /simulator/run, /simulator/scenarios, /simulator/status|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /simulator/status`|
|21|Sentinel|`/sentinel/status`; /sentinel/status, /sentinel/watch, /sentinel/scheduler/status …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /sentinel/status`|
|22|Mnemosyne|`/knowledge/status`; /knowledge/status, /knowledge/query, /knowledge/nodes …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /knowledge/status`|
|23|Cartographer|`/mirror/status`; /mirror/, /mirror/status, /mirror/state …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /mirror/status`|
|24|Nexus|`/nexus/status`; /nexus/context, /nexus/full, /nexus/orchestrate …|Orchestration level service|status 404|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|❌|`curl /nexus/status`|
|25|Bridge|`/bridge/status`; /bridge/status, /bridge/health, /bridge/connect …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /bridge/status`|
|26|Orchestrator|`/conductor/status`; /conductor/status, /conductor/workflow, /conductor/workflow_async …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /conductor/status`|
|27|Forge|`/forge/status`; /forge/status, /forge/health, /forge/templates …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /forge/status`|
|28|Polyglot|`/polyglot/status`; /polyglot/status, /polyglot/languages, /polyglot/translate …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /polyglot/status`|
|29|Muse|`/muse/status`; /muse/status, /muse/inspire, /muse/brainstorm|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /muse/status`|
|30|Seer|`/seer/status`; /seer/status, /seer/predict, /seer/trends|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /seer/status`|
|31|Mediator|`/mediator/status`; /mediator/status, /mediator/mediate, /mediator/resolve|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /mediator/status`|
|32|Synthesist|`/synthesist_api/status`; /synthesist_api/status, /synthesist_api/ingest, /synthesist_api/synthesize …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /synthesist_api/status`|
|33|ethicist|`/ethicist/status`; /ethicist/evaluate, /ethicist/review, /ethicist/guidelines …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /ethicist/status`|
|34|validator|`/validator/status`; /validator/validate, /validator/schema, /validator/schemas …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /validator/status`|
|35|singularity|`/singularity/status`; /singularity/analyze, /singularity/improve, /singularity/metrics …|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /singularity/status`|
|36|Conductor (Meta)|`/meta_conductor/status`; /conductor/status, /conductor/workflow, /conductor/workflow_async …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|Always-on support to multi-level orchestration|✅|`curl /meta_conductor/status`|
|37|Awareness|`/awareness/status`; /awareness/status, /awareness/introspect, /awareness/memory …|Orchestration level service|status 200, state=active|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /awareness/status`|
|38|Augmenter|`/augmenter/status`; /augmenter/chat, /augmenter/status|Orchestration level service|status 200|Up: Nexus/Conductor; Down: router-specific workers|On-demand support via Nexus routing|✅|`curl /augmenter/status`|

## Cross-Level Interaction Checks

1. **Orchestration path**: `nexus/orchestrate?query=brainstorm:...` forced chain L13→L29→L32 plus always-on levels; includes workflow checkpoint and rollback metadata.
2. **Fallback path**: `/fallback/status` shows fallback+self-heal enabled; no recent events.
3. **Activation metadata/HUD integrity**: success responses generally include contract metadata; 404 responses correctly exclude HUD (validated by self-test). Alias inconsistency detected on `/orchestrator/status`.
4. **Scheduler interactions**: Cron active, Sentinel scheduler running (watchers=4), Night Shift running with next 03:00 schedule.
5. **SAFE_MODE route consistency**: runtime env confirms SAFE_MODE true; route behavior remains stable for tested orchestration/status endpoints.

## Concrete Evidence (commands + responses)

### health
```bash
curl -sS http://10.0.0.52:8888/health
```
```
{"status": "healthy", "service": "cortex", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}, "success": true, "response_shape_version": "cortex.v1"}
```

### kernel_levels
```bash
curl -sS http://10.0.0.52:8888/kernel/levels
```
```
{"success": true, "levels": [{"level": 1, "status": "online"}, {"level": 2, "status": "online"}, {"level": 3, "status": "online"}, {"level": 4, "status": "online"}, {"level": 5, "status": "online"}, {"level": 6, "status": "online"}, {"level": 7, "status": "online"}, {"level": 8, "status": "online"}, {"level": 9, "status": "online"}, {"level": 10, "status": "online"}, {"level": 11, "status": "online"}, {"level": 12, "status": "online"}, {"level": 13, "status": "online"}, {"level": 14, "status": "online"}, {"level": 15, "status": "online"}, {"level": 16, "status": "online"}, {"level": 17, "status": "online"}, {"level": 18, "status": "online"}, {"level": 19, "status": "online"}, {"level": 20, "status": "online"}, {"level": 21, "status": "online"}, {"level": 22, "status": "online"}, {"level": 23, "status": "online"}, {"level": 24, "status": "online"}, {"level": 25, "status": "online"}, {"level": 26, "status": "online"}, {"level": 27, "status": "online"}, {"level": 28, "status": "online"}, {"level": 29, "status": "online"}, {"level": 30, "status": "online"}, {"level": 31, "status": "online"}, {"level": 32, "status": "online"}, {"level": 33, "status": "online"}, {"level": 34, "status": "online"}, {"level": 35, "status": "online"}, {"level": 36, "status": "online"}, {"level": 37, "status": "online"}, {"level": 38, "status": "online"}], "timestamp": "2026-02-19T16:08:41.976686Z", "response_shape_version": "cortex.v1", "contract": {"identity_phrase": "Cortex-first orchestration active
```

### endpoint_map
```bash
curl -sS http://10.0.0.52:8888/meta_conductor/endpoint_map
```
```
{"success": true, "generated_at": "2026-02-19T16:08:41.984615Z", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}, "levels": [{"level": 1, "name": "Kernel", "canonical_status": "/kernel/status", "aliases": []}, {"level": 2, "name": "Ghost (Browser)", "canonical_status": "/browser/status", "aliases": []}, {"level": 3, "name": "Parser", "canonical_status": "/parsers/status", "aliases": []}, {"level": 4, "name": "Lab", "canonical_status": "/lab/status", "aliases": []}, {"level": 5, "name": "Oracle", "canonical_status": "/oracle/status", "aliases": []}, {"level": 6, "name": "Bard", "canonical_status": "/bard/status", "aliases": []}, {"level": 7, "name": "Librarian", "canonical_status": "/librarian/status", "aliases": []}, {"level": 8, "name": "Cron", "canonical_status": "/cron/status", "aliases": []}, {"level": 9, "name": "Architect", "canonical_status": "/architect/status", "aliases": []}, {"level": 10, "name": "Listener", "canonical_status": "/listener/status", "aliases": []}, {"level": 11, "name": "Catalyst", "canonical_status": "/catalyst/status", "aliases": []}, {"level": 12, "name": "Hive/Darwin", "canonical_status": "/hive/status", "aliases": []}, {"level": 13, "name": "Dreamer", "canonical_status": "/dreamer/status", "aliases": []}, {"level": 14, "name": "Chronos (Night Shift)", "canonical_status": "/night_shift/status", "aliases":
```

### contract_test
```bash
curl -sS http://10.0.0.52:8888/contract/self-test
```
```
{"success": true, "checks": {"identity_phrase_contract_metadata_available": {"pass": true, "status": 200, "identity_phrase": "Cortex-first orchestration active"}, "brainstorm_trigger_hard_routed": {"pass": true, "status": 200, "routing_method": "brainstorm_chain_forced", "routing_markers": {"cortex_first": true, "brainstorm_triggered": true, "brainstorm_chain": ["dreamer", "muse", "synthesist"]}}, "routing_method_present_truthful": {"pass": true, "status": 200, "routing_method": "qa_fastlane"}, "404_has_no_hud_attribution": {"pass": true, "status": 404, "body": {"detail": "Not Found"}}}, "verdict": "pass", "response_shape_version": "cortex.v1", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}}
```

### nexus_brainstorm
```bash
curl -sS 'http://10.0.0.52:8888/nexus/orchestrate?query=brainstorm:%20growth%20strategy%20for%20small%20SaaS'
```
```
{"success": true, "query": "brainstorm: growth strategy for small SaaS", "recommended_levels": [{"level": 13, "name": "dreamer", "method": "brainstorm_forced"}, {"level": 29, "name": "muse", "method": "brainstorm_forced"}, {"level": 32, "name": "synthesist", "method": "brainstorm_forced"}, {"level": 5, "name": "oracle", "always_on": true}, {"level": 17, "name": "exoskeleton", "always_on": true}, {"level": 18, "name": "diplomat", "always_on": true}, {"level": 20, "name": "simulator", "always_on": true}, {"level": 21, "name": "ouroboros", "always_on": true}, {"level": 22, "name": "mnemosyne", "always_on": true}, {"level": 23, "name": "cartographer", "always_on": true}, {"level": 24, "name": "nexus", "always_on": true}, {"level": 25, "name": "bridge", "always_on": true}, {"level": 27, "name": "forge", "always_on": true}, {"level": 33, "name": "ethicist", "always_on": true}, {"level": 34, "name": "validator", "always_on": true}, {"level": 35, "name": "singularity", "always_on": true}, {"level": 36, "name": "conductor", "always_on": true}], "reasoning": ["Brainstorm trigger detected; forcing Dreamer+Muse before synthesis."], "semantic_analysis": {"intents": [], "confidence": 0, "method": "fallback"}, "routing_method": "brainstorm_chain_forced", "routing_markers": {"cortex_first": true, "brainstorm_triggered": true, "brainstorm_chain": ["dreamer", "muse", "synthesist"]}, "workflow_checkpoint": {"checkpoint_id": "1b78c84c97fba3a0", "state_machine": ["received", "analyzed", "planned"
```

### cron_status
```bash
curl -sS http://10.0.0.52:8888/cron/status
```
```
{"success": true, "level": 8, "name": "Cron", "status": "active", "scheduled_jobs": 0, "capabilities": ["schedule", "jobs", "trigger"], "response_shape_version": "cortex.v1", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}}
```

### sentinel_scheduler
```bash
curl -sS http://10.0.0.52:8888/sentinel/scheduler/status
```
```
{"success": true, "running": true, "interval_seconds": 1800, "scans_completed": 1, "watchers_count": 4, "response_shape_version": "cortex.v1", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}}
```

### night_shift
```bash
curl -sS http://10.0.0.52:8888/night_shift/status
```
```
{"success": true, "level": 14, "name": "Chronos (Night Shift)", "status": "running", "last_run_date": "2026-02-19", "next_scheduled_run": "2026-02-20T03:00:00", "capabilities": ["nightly_evolution_cycle", "dream_gap_detection", "council_review", "skill_materialization", "diplomat_briefing", "geneticist_dna_evolution"], "response_shape_version": "cortex.v1", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}}
```

### queue_status_timeout
```bash
curl -sS -m 5 -w '
CURL_EXIT=%{exitcode} HTTP=%{http_code}
' http://10.0.0.52:8888/queue/status
```
```
Command 'curl -sS -m 5 -w '
CURL_EXIT=%{exitcode} HTTP=%{http_code}
' http://10.0.0.52:8888/queue/status' returned non-zero exit status 28.
```

### kernel_status_missing
```bash
curl -sS -i http://10.0.0.52:8888/kernel/status | head -n 1
```
```
HTTP/1.1 404 Not Found
```

### architect_status_missing
```bash
curl -sS -i http://10.0.0.52:8888/architect/status | head -n 1
```
```
HTTP/1.1 404 Not Found
```

### nexus_status_missing
```bash
curl -sS -i http://10.0.0.52:8888/nexus/status | head -n 1
```
```
HTTP/1.1 404 Not Found
```

### conductor_status
```bash
curl -sS http://10.0.0.52:8888/conductor/status
```
```
{"success": true, "data": {"level": 26, "name": "The Orchestrator", "role": "Workflow Orchestration", "description": "Coordinates multi-level execution workflows (NOT L36 Meta-Conductor)", "status": "active", "workflows_created": 0, "workflows_executed": 0, "workflows_stored": 0, "always_on": true, "timestamp": "2026-02-19T16:08:50.757650"}, "error": null, "response_shape_version": "cortex.v1", "hud": "\ud83d\udfe2 L36 (Conductor)", "activated_levels": [{"level": 36, "name": "conductor", "derived_from": "route", "always_on": false}], "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}}
```

### orchestrator_status
```bash
curl -sS http://10.0.0.52:8888/orchestrator/status
```
```
{"success": true, "data": {"level": 26, "name": "The Orchestrator", "role": "Workflow Orchestration", "description": "Coordinates multi-level execution workflows (NOT L36 Meta-Conductor)", "status": "active", "workflows_created": 0, "workflows_executed": 0, "workflows_stored": 0, "always_on": true, "timestamp": "2026-02-19T16:08:50.764286"}, "error": null, "response_shape_version": "cortex.v1", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": true, "activation_metadata_source": "derived", "contract_version": "cortex.contract.v1"}}
```

### safe_mode_env
```bash
ssh jake@10.0.0.52 'docker inspect cortex-brain --format "{{range .Config.Env}}{{println .}}{{end}}" | grep CORTEX_SAFE_MODE'
```
```
CORTEX_SAFE_MODE=true
```

## Remediation Plan with Verify-by Commands

1. **Fix canonical endpoint map drift (P0)**
   - Update `meta_conductor endpoint_map` generation to emit existing canonical statuses for L1/L9/L24 (or implement missing endpoints).
   - Verify:
   ```bash
   curl -sS http://10.0.0.52:8888/meta_conductor/endpoint_map | jq ".levels[] | select(.level==1 or .level==9 or .level==24)"
   curl -sS -o /dev/null -w "%{http_code}
" http://10.0.0.52:8888/<new-canonical-status>
   ```
2. **Restore queue health path (P0)**
   - Inspect queue router worker lock/dependency; ensure `/queue/status` is non-blocking and returns contract envelope.
   - Verify:
   ```bash
   time curl -sS -m 2 http://10.0.0.52:8888/queue/status | jq ".success,.status"
   ```
3. **Unify alias contracts (P1)**
   - Align `/orchestrator/*` wrappers with `/conductor/*` HUD + activated_levels metadata behavior.
   - Verify:
   ```bash
   diff <(curl -sS http://10.0.0.52:8888/conductor/status | jq "keys") \
        <(curl -sS http://10.0.0.52:8888/orchestrator/status | jq "keys")
   ```
4. **Document/normalize level-role registry (P1/P2)**
   - Single source for Level↔Router↔Canonical status in code + docs to prevent drift.
   - Verify:
   ```bash
   curl -sS http://10.0.0.52:8888/kernel/levels
   curl -sS http://10.0.0.52:8888/meta_conductor/endpoint_map
   ```