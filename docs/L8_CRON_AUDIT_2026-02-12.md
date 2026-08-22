# L8 (Cron) Full Audit — Cortex VM 10.0.0.52
Date: 2026-02-12 22:19 CST request (executed 2026-02-13 UTC)
Auditor: OpenClaw subagent

## Executive Summary
- **Overall L8 Cron status: PASS (after minimal fixes).**
- L8 endpoints are live and functional: `/cron/status`, `/cron/schedule`, `/cron/jobs`, `/cron/trigger`.
- Functional tests passed for schedule/list/trigger and key failure paths.
- Two issues were found and fixed safely:
  1) deleting non-existent cron job returned **500** (now **404** with clear error),
  2) listed job name showed function name (`trigger_celery_task`) instead of requested `job_name`.
- Cross-level dependency checks with **L5 Oracle** and **L15 Council** were executed and responsive.
- Changes were made minimally in `/opt/clawdbot/cortex_server/...`, backed up first, and verified after container restart.

---

## 1) Original intended purpose of L8 from code/docs/history
### Findings
L8 is intended to provide **cron-style scheduling + immediate trigger of Celery tasks**:
- `/opt/clawdbot/cortex_server/cortex_server/routers/cron.py`
  - docstring: “API endpoints for cron scheduling and webhook triggers.”
  - routes: schedule/list/delete/trigger/status.
- `/opt/clawdbot/cortex_server/cortex_server/scheduler.py`
  - APScheduler-backed cron parsing and Celery task dispatch (`trigger_celery_task`).

### Architecture note (important)
There is a parallel scheduling subsystem labeled **L14 Chronos**:
- `/opt/clawdbot/cortex_server/main.py` startup comment: “Start Level 14: Chronos Night Shift Scheduler”
- `/opt/clawdbot/cortex_server/cortex_server/modules/chronos.py` describes Level 14 nightly pipeline.

So current architecture contains both:
- **L8 Cron router/scheduler** (API cron jobs)
- **L14 Chronos** (nightly autonomous evolution scheduler)

Runtime HUD confirms L8 labeling on cron endpoints (`"_hud":"🔵 L8 (Cron)"`).

### History availability
Git history for these files is limited on-host (single visible initial commit), so deeper historical evolution of L8 naming is not recoverable from local git log in current state.

---

## 2) Runtime behavior / endpoints / status verification
Verified against `http://10.0.0.52:8888`:
- `GET /health` => healthy
- `GET /cron/status` => L8 active with capabilities
- `GET /cron/jobs` => returns scheduled jobs list + HUD tag
- `POST /cron/schedule` => accepts cron + task + args and returns next run time
- `POST /cron/trigger` => returns task_id and “triggered”

Evidence log:
- `/root/.openclaw/workspace/audits/l8_audit_evidence_2026-02-12.txt`
- `/opt/clawdbot/docs/l8_audit_evidence_2026-02-12.txt`

---

## 3) Functional tests (schedule/trigger/status/failure handling)
### Pre-fix test outcomes
1. Invalid cron expression (`* * * *`) -> **400** with clear validation error ✅
2. Unknown task on trigger -> **404** ✅
3. Valid schedule (`*/1 * * * *`, task `cortex_tasks.add`) -> job created ✅
4. Job listing reflected scheduled job ✅
5. Immediate trigger returned task_id; queue status visible as pending ✅
6. Delete existing scheduled job -> **200 removed** ✅
7. Delete non-existent job -> **500 Internal Server Error** ❌ (bug)

### Post-fix retest
1. Schedule + list shows requested `job_name` correctly ✅
2. Delete non-existent job now returns **404 Job not found** ✅
3. Cleanup deletion of created test job works ✅

Post-fix evidence:
- `/root/.openclaw/workspace/audits/l8_audit_evidence_postfix_2026-02-12.txt`
- `/opt/clawdbot/docs/l8_audit_evidence_postfix_2026-02-12.txt`

---

## 4) Cross-level checks with L5 Oracle and L15 Council
Executed dependency checks:
- `GET /oracle/status` => online; bridge path active
- `POST /oracle/chat` => returned `ORACLE_OK` via bridge model
- `GET /council/status` => active, oracle-powered
- `POST /council/deliberate` => successful deliberation payload returned
- `GET /cron/status` => remained active during/after cross-level calls

Cross-level evidence:
- `/root/.openclaw/workspace/audits/l8_audit_crosslevel_2026-02-12.txt`
- `/opt/clawdbot/docs/l8_audit_crosslevel_2026-02-12.txt`

---

## 5) Minimal upgrades/fixes implemented
### Files changed (persistent host path)
1. `/opt/clawdbot/cortex_server/cortex_server/scheduler.py`
   - Added `JobLookupError` handling in `remove_job()` to return `False` when missing.
   - Set APScheduler `name=job_name` so `/cron/jobs` reflects requested job name.

2. `/opt/clawdbot/cortex_server/cortex_server/routers/cron.py`
   - Replaced mutable default list args with `Field(default_factory=list)`.
   - `DELETE /cron/jobs/{job_id}` now:
     - returns 404 for missing job (`Job not found: <id>`),
     - returns removed job_id on success.

### Backups created before edit
- `/opt/clawdbot/cortex_server/cortex_server/scheduler.py.bak.l8audit_20260212`
- `/opt/clawdbot/cortex_server/cortex_server/routers/cron.py.bak.l8audit_20260212`

### Deployment action
- Restarted container: `docker restart cortex-brain`

---

## 6) Re-test pass/fail matrix
- L8 status endpoint: **PASS**
- L8 schedule valid cron: **PASS**
- L8 jobs listing: **PASS**
- L8 trigger immediate: **PASS**
- L8 invalid cron handling: **PASS**
- L8 unknown task handling: **PASS**
- L8 delete missing job handling: **PASS (after fix)**
- L8 list job name fidelity: **PASS (after fix)**
- Cross-level L5 Oracle dependency: **PASS**
- Cross-level L15 Council dependency: **PASS**

Final verdict: **PASS**

---

## 7) Artifacts
### Persistent host docs
- `/opt/clawdbot/docs/L8_CRON_AUDIT_2026-02-12.md`
- `/opt/clawdbot/docs/l8_audit_evidence_2026-02-12.txt`
- `/opt/clawdbot/docs/l8_audit_evidence_postfix_2026-02-12.txt`
- `/opt/clawdbot/docs/l8_audit_crosslevel_2026-02-12.txt`

### Workspace copies
- `/root/.openclaw/workspace/audits/L8_CRON_AUDIT_2026-02-12.md`
- `/root/.openclaw/workspace/audits/l8_audit_evidence_2026-02-12.txt`
- `/root/.openclaw/workspace/audits/l8_audit_evidence_postfix_2026-02-12.txt`
- `/root/.openclaw/workspace/audits/l8_audit_crosslevel_2026-02-12.txt`

---

## 8) Rollback steps
If rollback is needed:

```bash
# 1) Restore backups
cp -a /opt/clawdbot/cortex_server/cortex_server/scheduler.py.bak.l8audit_20260212 \
      /opt/clawdbot/cortex_server/cortex_server/scheduler.py
cp -a /opt/clawdbot/cortex_server/cortex_server/routers/cron.py.bak.l8audit_20260212 \
      /opt/clawdbot/cortex_server/cortex_server/routers/cron.py

# 2) Restart service
docker restart cortex-brain

# 3) Verify
curl -s http://10.0.0.52:8888/cron/status
curl -s -i -X DELETE http://10.0.0.52:8888/cron/jobs/nonexistent_test
```

Expected rollback behavior: missing job delete may revert to previous 500 behavior and job list naming may revert to function-name label.
