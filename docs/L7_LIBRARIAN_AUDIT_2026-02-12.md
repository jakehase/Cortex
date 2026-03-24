# L7 (Librarian) Full Audit — Cortex VM 10.0.0.52
Date: 2026-02-12 21:43 CST request (executed 2026-02-13 UTC)
Auditor: OpenClaw subagent

## Executive Summary
- **Overall L7 status: PASS (with cross-level dependency caveat).**
- L7 endpoints are present and healthy: `/librarian/status`, `/librarian/embed`, `/librarian/search`, `/librarian/stats`.
- Functional tests for embed/search/stats passed, including validation behavior and post-restart retrieval.
- **Persistence risk identified and fixed safely:** Chroma path was container-internal (`/root/cortex_server/chroma_db`), risking loss on rebuild/recreate.
- Implemented minimal persistent fix: use `/app/cortex_server/chroma_db` (host-mounted) + one-time migration from legacy path.
- Re-test after restart passed; prior marker memory remained searchable.
- Cross-level path (L5 Oracle + L15 Council): status endpoints show active, but action calls timed out (HTTP `000`) during audit window.

## 1) Original Intended Purpose of L7 (code/docs/history)
Evidence indicates L7 is intended for **semantic memory storage/retrieval** and knowledge indexing:
- `/opt/clawdbot/cortex_server/cortex_server/routers/librarian.py`
  - Docstring: “Vector Memory Plugin… semantic memory storage and retrieval using ChromaDB.”
  - Capabilities: `embed`, `search`, `semantic_indexing`.
- `/opt/clawdbot/cortex_server/cortex_server/modules/librarian.py`
  - “Level 7: Librarian - Knowledge Graph”, indexing entries into persisted memory (`auto_memory.jsonl`).
- Historical parity:
  - `/opt/clawdbot/backups/pre_l34_20260209_183856/modules/librarian.py` shows same role/intent.
- Cross-module wiring confirms L7’s role in broader cognition:
  - Awareness auto-index calls (`librarian/embed`), Hive memory retrieval via librarian search/stats.

## 2) Runtime Behavior / Endpoints / Status
### Health and status
- `GET /health` => `{"status":"healthy","service":"cortex"}`
- `GET /librarian/status` => level 7 active with expected capabilities
- `GET /librarian/stats` => collection `cortex_memory`, count observed 11→12 during tests

### Endpoint availability (OpenAPI)
- `/librarian/status` [GET]
- `/librarian/embed` [POST]
- `/librarian/search` [POST]
- `/librarian/stats` [GET]

## 3) Functional Tests (embed/search/stats/status + persistence)
### T1: Embed + stats increment
- Before: `total_memories=11`
- `POST /librarian/embed` with marker text/metadata returned `{"id":"82b39fcd-...","status":"stored"}`
- After: `total_memories=12`

### T2: Search recall
- `POST /librarian/search` with marker query returned inserted ID/text/metadata as top hit.

### T3: Input validation
- Empty embed text => HTTP `400`, error `Text cannot be empty`
- Empty search query => HTTP `400`, error `Query cannot be empty`

### T4: Persistence across restart
- Restarted `cortex-brain`.
- `GET /librarian/stats` remained `12`.
- Marker still retrievable after restart via `/librarian/search`.

## 4) Cross-level checks (L5 Oracle + L15 Council) and dependency notes
### Status-level checks
- `GET /oracle/status` => online, `bridge_ok: true`
- `GET /council/status` => active, oracle_powered true

### Action-path checks
- `POST /oracle/chat` => timeout (HTTP `000` during audit)
- `POST /council/critique` => timeout (HTTP `000` during audit)

Interpretation:
- L7 core is healthy and functional.
- Governance/analysis path is currently degraded by dependency/runtime responsiveness in L5/L15 action path (despite status endpoints reporting active).

## 5) Proposed + implemented upgrades/fixes (minimal, safe, persistent)
### Issue found
In router code, Chroma persistence used:
- `CHROMA_DIR = "/root/cortex_server/chroma_db"`

Given compose mounts `/app/cortex_server` from host, `/root/...` is container-internal and can be lost on rebuild/recreate.

### Fix implemented
File changed:
- `/opt/clawdbot/cortex_server/cortex_server/routers/librarian.py`

Changes:
- Added `import shutil`
- Set:
  - `LEGACY_CHROMA_DIR = "/root/cortex_server/chroma_db"`
  - `CHROMA_DIR = "/app/cortex_server/chroma_db"`
- Added one-time migration: copy legacy dir to new dir if legacy exists and new does not.
- Restarted `cortex-brain`.

### Post-fix evidence
- Container path check:
  - `/root/cortex_server/chroma_db` exists (legacy)
  - `/app/cortex_server/chroma_db` exists (new persistent)
  - both ~`400K` immediately after migration
- Host path exists:
  - `/opt/clawdbot/cortex_server/cortex_server/chroma_db` (~`400K`)

## 6) Re-test pass/fail matrix
- L7 status endpoint: **PASS**
- L7 embed: **PASS**
- L7 search: **PASS**
- L7 stats: **PASS**
- L7 validation guards (empty input): **PASS**
- L7 persistence across service restart: **PASS**
- L5 Oracle action path (`/oracle/chat`): **FAIL (timeout dependency)**
- L15 Council action path (`/council/critique`): **FAIL (timeout dependency)**

## 7) Artifacts / evidence files
- Workspace report: `/root/.openclaw/workspace/audits/L7_LIBRARIAN_AUDIT_2026-02-12.md`
- Workspace command evidence log: `/root/.openclaw/workspace/audits/l7_audit_evidence_2026-02-12.txt`
- Host persistent report: `/opt/clawdbot/docs/L7_LIBRARIAN_AUDIT_2026-02-12.md`

## 8) Rollback steps (for changes made)
1. Identify backup created before patch:
   - `ls -1t /opt/clawdbot/cortex_server/cortex_server/routers/librarian.py.bak_l7audit_* | head -1`
2. Restore backup:
   - `cp -a <backup_file> /opt/clawdbot/cortex_server/cortex_server/routers/librarian.py`
3. Restart service:
   - `cd /opt/clawdbot && docker compose restart cortex-brain`
4. Verify:
   - `curl -s http://10.0.0.52:8888/librarian/status`
   - `curl -s http://10.0.0.52:8888/librarian/stats`

---

## Technical Appendix (selected command/output snippets)
```bash
curl -s http://10.0.0.52:8888/librarian/status
# {"success":true,"level":7,"name":"Librarian","status":"active",...}

curl -s http://10.0.0.52:8888/librarian/stats
# {"total_memories":11,"collection":"cortex_memory",...}
# (after embed: total_memories=12)

curl -s -X POST http://10.0.0.52:8888/librarian/embed \
  -H 'Content-Type: application/json' \
  -d '{"text":"L7 audit persistence marker ...","metadata":{"source":"l7_audit"}}'
# {"id":"82b39fcd-...","status":"stored"}

curl -s -X POST http://10.0.0.52:8888/librarian/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"l7_audit_1770954280_","n_results":1}'
# returns inserted marker memory

ssh jake@10.0.0.52 'docker exec cortex-brain sh -lc "du -sh /root/cortex_server/chroma_db /app/cortex_server/chroma_db"'
# 400K /root/cortex_server/chroma_db
# 400K /app/cortex_server/chroma_db
```
