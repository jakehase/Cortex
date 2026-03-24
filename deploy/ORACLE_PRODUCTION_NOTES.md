# Oracle production readiness notes

## 2026-03-17

Oracle was made production-safe by shifting from a brittle single-lane dependency chain:
- local OpenClaw via OpenAI Codex OAuth
- external bridge at `10.0.0.220:18999`
- optional tinyllama local fallback

to a resilient fallback posture where Oracle can still serve when:
- OpenClaw OAuth refresh tokens are stale/reused
- the external bridge is down/refusing connections
- local Ollama/tinyllama is unavailable

### Live production behavior
- `ORACLE_EMERGENCY_BYPASS=false`
- `ORACLE_FALLBACKS_ENABLED=true`
- local OpenClaw remains the preferred lane when healthy
- bridge remains available if restored later

### Operational note
### Validation
Observed live responses on `http://127.0.0.1:18888/oracle/chat` before OpenRouter removal:
- HTTP 200
- no emergency static response

OpenRouter was later removed from the Oracle fallback chain at user request and should not be used.

## 2026-03-21

A later reliability/performance incident was fully traced and fixed.

Root cause summary:
- internal oracle sessions were accumulating too much prompt/history baggage
- the executor reused stable prompt-derived session ids
- `openclaw agent --json` output parsing was brittle under plugin-log noise
- most importantly, named-agent runs (`--agent oracle`) were overriding explicit `--session-id`, collapsing requests into a sticky logical session (`agent:oracle:main`)

Permanent fix summary:
- dedicated tiny workspace: `/root/clawd/deploy/oracle-workspace-lite`
- local execution on CT101 (`ORACLE_EXECUTOR_LOCAL=true`)
- explicit per-request oracle session ids
- cleanup bound to `/root/.openclaw/agents/oracle/sessions`
- OpenClaw runtime patched so named agents honor explicit session ids instead of forcing a fixed session key

Validation summary after the final fix:
- 5-way concurrent burst: **5/5 succeeded**, average ~10s
- mixed soak test (20 total requests): **20/20 succeeded**, average **7.42s**, p95 **10.54s**, max **13.33s**
- oracle transcript files remained tiny (~2.2K–3.5K), with no recurrence of giant poisoned sessions

Detailed writeup:
- `docs/ORACLE_BRIDGE_RELIABILITY_FIX_2026-03-21.md`
