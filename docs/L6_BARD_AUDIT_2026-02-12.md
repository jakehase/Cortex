# L6 (Bard) Full Audit — Cortex VM 10.0.0.52
Date: 2026-02-12 21:07 CST request (executed 2026-02-13 UTC)
Auditor: OpenClaw subagent

## Executive Summary
- **Overall L6 status: PASS (with caveats)**
- L6 Bard is running and reachable (`/bard/status` active, Piper reachable over Wyoming TCP).
- Core intended capability (text-to-speech) is functional (`/bard/speak` returns valid WAV base64; RIFF header verified).
- Input validation works for empty text (HTTP 400).
- Runtime endpoints are present in OpenAPI (`/bard/status`, `/bard/speak`, `/bard/voices`).
- Cross-level check completed with L5 Oracle + L15 Council earlier in-session and recommended **no immediate upgrade** unless a concrete requirement exists.
- **Risk found during re-check:** L5 Oracle became unstable post-restart (503 bridge error), causing L15 Council failure (502 via Oracle dependency). This is outside L6 implementation but impacts cross-level reliability.
- A proposed L6 micro-upgrade (voice parameter validation) was attempted and **rolled back immediately** after causing syntax error; service restored healthy. No persistent risky change remains.

## 1) Original Intended Purpose of L6 (code/docs/history)
Evidence indicates L6 is intended as **voice output / text-to-speech**:
- `/opt/clawdbot/cortex_server/cortex_server/routers/bard.py` docstring: "Bard Router - Text-to-Speech via Piper Wyoming protocol."
- `/opt/clawdbot/cortex_server/cortex_server/modules/bard.py`: "The Bard gives voice to The Cortex via Piper TTS."
- Historical backup parity:
  - `/opt/clawdbot/backups/pre_l34_20260209_183856/modules/bard.py`
  - same role wording and `speak()` semantic.
- Workspace historical docs corroborate L6 role:
  - `CORTEX_LEVELS.md` (L6: BARD)
  - `CORTEX_FIXES_APPLIED.md` (Piper/Wyoming fix references)

## 2) Runtime Behavior / Endpoints / Status
### Health + status
- `GET /health` => healthy
- `GET /bard/status` => level 6 active; Piper reachable true; protocol Wyoming

### Endpoint availability
From `openapi.json`:
- `/bard/status` [GET]
- `/bard/speak` [POST]
- `/bard/voices` [GET]

## 3) Functional Tests
### T1: Speak smoke test
Command pattern: `POST /bard/speak` with short text.
Observed:
- `success: true`
- `format: wav`
- `sample_rate: 22050`
- duration returned
- decoded payload starts with `RIFF` (valid WAV container)

### T2: Empty input validation
`POST /bard/speak` with whitespace-only text -> `400` and error indicating empty text.

### T3: Voices listing
`GET /bard/voices` returns `en_US-lessac-medium`, Piper reachable true.

## 4) Cross-Level Checks (L5 + L15)
### Successful run (earlier in session)
- L5 `POST /oracle/chat` answered: L6 Bard is Cortex voice/TTS layer (Piper-backed).
- L15 `POST /council/critique` raw response: upgrading L6 immediately is premature without concrete requirement (e.g., more voices/naturalness/perf bottleneck).

### Later re-check (after container restart)
- L5 Oracle failed: `503` bridge error (`appendHudIfNeeded is not defined`)
- L15 Council failed with `502` due Oracle dependency.

Interpretation:
- L6 itself is healthy.
- Cross-level advisory path is intermittently blocked by Oracle bridge issue (non-L6 dependency).

## 5) Proposed / Implemented Fixes or Upgrades
### Proposed safe L6 upgrade
- Validate `voice` argument in `/bard/speak` and return explicit unsupported-voice error.
- Echo `voice_used` in response for observability.

### Implementation attempt + rollback
- Modified file: `/opt/clawdbot/cortex_server/cortex_server/routers/bard.py`
- Backup created: `/opt/clawdbot/cortex_server/cortex_server/routers/bard.py.bak_l6audit_20260213`
- A syntax error in f-string caused `cortex-brain` restart loop.
- Immediate rollback to backup completed; service returned healthy.

**Final state:** no active L6 code changes beyond restored original; system healthy.

## 6) Re-test + Pass/Fail
- L6 status endpoint: **PASS**
- L6 voices endpoint: **PASS**
- L6 speak synthesis: **PASS**
- Empty-input guard: **PASS**
- L5/L15 cross-level availability (post-restart): **FAIL (dependency issue outside L6 core)**

## 7) Risks & Next Actions
### Risks
1. **Oracle bridge instability** can block Council deliberation and cross-level governance.
2. L15 parse quality appears weak (scores defaulting to zero despite useful raw text), reducing structured decision quality.
3. L6 currently advertises a `voice` field but practical multi-voice capability remains single-voice.

### Next Actions
1. Fix Oracle bridge runtime error: `appendHudIfNeeded is not defined` (L5 reliability).
2. Improve L15 parsing fallback to avoid zero-score outputs when raw_response is present.
3. If desired, implement L6 voice validation in a tested PR-style path (lint + syntax check before restart).
4. Optional: add `GET /bard/healthz` latency metric and synthesis timeout telemetry.

---

## Technical Appendix (Commands & Snippets)
### Runtime checks
- `curl -s http://10.0.0.52:8888/health`
  - `{"status":"healthy","service":"cortex"}`
- `curl -s http://10.0.0.52:8888/bard/status`
  - shows level 6 active, `piper_tts.reachable=true`

### L6 smoke evidence
- `POST /bard/speak` output parsed:
  - `success=True format=wav sample_rate=22050 channels=1`
  - decoded WAV magic: `RIFF`

### Cross-level successful evidence (earlier)
- Oracle response snippet:
  - `"L6 Bard is Cortex’s voice layer, handling text-to-speech output..."`
- Council critique raw snippet:
  - `"...premature... change risk for little immediate gain unless concrete requirement..."`

### Cross-level failure evidence (later)
- Oracle 503:
  - `Bridge error (500): ... ReferenceError: appendHudIfNeeded is not defined`
- Council 502:
  - `Oracle error: Server error '503 Service Unavailable'`

### Change control evidence
- attempted file: `/opt/clawdbot/cortex_server/cortex_server/routers/bard.py`
- rollback backup used: `/opt/clawdbot/cortex_server/cortex_server/routers/bard.py.bak_l6audit_20260213`
- container restored healthy via `docker compose restart cortex-brain`
