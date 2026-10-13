# Oracle production readiness notes

## 2026-10-11 least-privilege source design

The ordinary Cortex API no longer needs to execute OpenClaw or write its state. The source deployment now routes nested Oracle execution to `cortex-oracle-executor.service` over authenticated loopback HTTP. The helper uses a service-owned OpenClaw state root under `/var/lib/cortex-oracle`; only the active main-agent profile directory is mounted writable because this OpenClaw runtime resolves the Oracle agent's approved OAuth through that fallback store. Main-agent sessions and the rest of shared OpenClaw state remain hidden. The helper has an empty capability bounding set and a home view limited to explicit Oracle workspace/config paths. The Cortex API runs as the unprivileged `cortex` user, has an empty capability bounding set, cannot access `/root/.openclaw`, treats `/opt/clawdbot` as read-only for compatibility, and writes only its service-owned state/log/runtime directories. The environment contract moves its graph and L22 SQLite files into `/var/lib/cortex` so those workflows do not depend on the removed `/opt/clawdbot` write grant.

The helper requires a protected shared token, returns a response-bound HMAC plus the existing provider/model completion receipt, enforces `gpt-5.6-sol` and `xhigh`, and does not transmit a service-tier override. It continues to use the PMHNP OAuth profile approved September 25, 2026; no credential is copied into source.

This is a source candidate only. See `cortex-repair-20261011/SECURITY_POLICY_MIGRATION.md` for staged deployment, rollback, and residual risks.

## 2026-10-13 helper sandbox state-boundary correction

The first supervised deployment of the least-privilege helper reached the live provider policy probe but returned HTTP 503. Exact reproduction under the unit sandbox showed that `/usr/bin/openclaw` selected the restored shared state root while `ProtectSystem=strict` made it read-only; OpenClaw stopped on the Cortex memory-bridge startup lock before invoking the provider. The unit's `/root/.openclaw/agents/oracle` binds were not used by that runtime, and the Oracle agent actually resolves approved OAuth through the active main-agent profile fallback.

The corrected boundary gives the helper a dedicated state root under `/var/lib/cortex-oracle/openclaw-state`, mounts only the active main-agent profile directory there for coherent OAuth refresh, hides the original shared state tree, and leaves main-agent sessions unmounted. The route gate now recognizes OpenClaw's normalized `agent:oracle:explicit:<oracle-session>` identity, while ephemeral transcript cleanup follows the helper-owned session directory and all sidecar formats. Q9 also performs a metadata-only OAuth preflight before making live changes, and helper failures write only return code/length/hash diagnostics to the journal.

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
