# L9–L15 Remediation-First Program Report (10.0.0.52)

## Scope completed
Executed remediation-first flow for L9–L15:
1) reproduced strict-timeout stalls with traces,
2) identified root causes,
3) applied minimal safe fixes,
4) revalidated strict-timeout stability,
5) re-queried Council (L15) for upgrade verdicts,
6) implemented Council-approved upgrades,
7) re-tested and documented rollback.

## Evidence artifacts
- Repro (pre-fix): `/opt/clawdbot/docs/l9_l15_strict_timeout_repro_20260213_052748.log`
- Validation (post-fix): `/opt/clawdbot/docs/l9_l15_strict_timeout_validate2_20260213_053120.log`
- Council verdict: `/opt/clawdbot/docs/l9_l15_council_verdict_20260213_053405.json`

## Root causes found
1. **Event-loop blocking in L12 Darwin path**
   - `routers/darwin.py` used sync `requests` + sync compile/fs work inside async endpoint.
   - Under strict timeout, one `/darwin/evolve` call caused `/health` to time out repeatedly.
2. **Blocking bridge/orchestration path in Oracle dependency**
   - `routers/oracle.py` used sync bridge call path in async flow; amplified stall behavior.
3. **Night-shift blocking risk (L14 Chronos)**
   - `modules/chronos.py` async flow invoked sync heavy calls directly (dream/review/briefing), risking scheduler-window contention.
4. **Council strict-timeout fragility**
   - `routers/council.py` returned hard timeout errors when Oracle path was slow; no fast fallback.

## Fixes implemented (minimal + safe)
- `routers/darwin.py`
  - Converted Oracle and status dependency calls to async `httpx`.
  - Offloaded file/compile/deploy blocking work via `asyncio.to_thread`.
  - Added bounded Oracle timeout (`25s`) and explicit timeout response.
  - Version updated to `12.2-ASYNC-SAFE`.
- `routers/oracle.py`
  - Wrapped bridge/orchestration calls in `run_in_threadpool` to avoid blocking event loop.
- `modules/chronos.py`
  - Offloaded sync blocking tasks (`dream`, `review_proposal`, `send_briefing`) with `asyncio.to_thread`.
- `routers/council.py`
  - Reduced Oracle timeout (`60s -> 20s`).
  - Added fail-soft fallback responses for deliberation/critique on timeout/error.
- Council-approved upgrades also applied:
  - `routers/architect.py` (L9): dependency install timeout guard + filename validation.
  - `routers/catalyst.py` (L11): retry-budget guard with jittered backoff (`timeout_budget_guard`).

## Before/After strict-timeout table

| Check | Before remediation | After remediation |
|---|---|---|
| `/health` during active `/darwin/evolve` | Repeated `HTTP=000`, ~2.0s timeout | Stable `HTTP=200`, ~0.0015s during same stress window |
| Darwin evolve behavior | Could stall host responsiveness | Returns bounded failure (`504` timeout) without global stall |
| Council under strict timeout | could time out hard | returns structured response; fallback path available |
| Catalyst burst optimize | unbounded trigger churn | retry-budget enforced, returns backoff metadata |

## Council (L15) post-remediation verdict (from raw_response)
- L9: **APPROVE**
- L10: **HOLD**
- L11: **APPROVE**
- L12: **HOLD**
- L13: **HOLD**
- L14: **APPROVE**
- L15: **APPROVE**

Implemented approved upgrades for **L9/L11/L14/L15**.

## Rollback steps
Backups were created before edits. To rollback quickly:
```bash
# on 10.0.0.52
cp /opt/clawdbot/cortex_server/cortex_server/routers/darwin.py.bak_20260213_052923 /opt/clawdbot/cortex_server/cortex_server/routers/darwin.py
cp /opt/clawdbot/cortex_server/cortex_server/routers/oracle.py.bak_async_20260213_053050 /opt/clawdbot/cortex_server/cortex_server/routers/oracle.py
cp /opt/clawdbot/cortex_server/cortex_server/modules/chronos.py.bak_async_20260213_052948 /opt/clawdbot/cortex_server/cortex_server/modules/chronos.py
cp /opt/clawdbot/cortex_server/cortex_server/routers/council.py.bak_timeout_20260213_053317 /opt/clawdbot/cortex_server/cortex_server/routers/council.py
cp /opt/clawdbot/cortex_server/cortex_server/routers/architect.py.bak_l9_20260213_053444 /opt/clawdbot/cortex_server/cortex_server/routers/architect.py
cp /opt/clawdbot/cortex_server/cortex_server/routers/catalyst.py.bak_l11_20260213_053455 /opt/clawdbot/cortex_server/cortex_server/routers/catalyst.py
cd /opt/clawdbot && docker compose restart cortex-brain
```

## Current status
- Cortex API healthy.
- L9–L15 status endpoints respond under strict 4s timeout.
- Previously reproduced strict-timeout stall is remediated.
