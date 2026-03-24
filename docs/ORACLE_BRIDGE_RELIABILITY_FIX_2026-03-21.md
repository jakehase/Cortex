# Oracle bridge reliability fix — 2026-03-21

## Summary

The Oracle bridge had two intertwined production problems:

1. **Missed or delayed replies** caused by oversized/reused internal sessions and brittle bridge error handling.
2. **Poor burst performance** caused by a sticky named-agent session key plus bridge parsing/runtime bottlenecks.

The final production-safe fix was:

- keep a **dedicated tiny oracle workspace**
- use **local execution** on CT101
- use **real per-request session IDs**
- patch OpenClaw so named agents do **not** override explicit `--session-id`
- keep bounded session cleanup in the oracle agent session directory

This removed the need for per-request session resets and eliminated the previous history-growth failure mode.

---

## Root cause chain

### 1) Duplicate / weird response behavior in the main assistant path
Early investigation found three separate issues on the main assistant side:

- `plugins/outbound-dedupe/index.ts` was ignoring short replies because dedupe only applied above a higher normalized-length threshold.
- `plugins/completion-integrity/core.mjs` was broad enough to classify some conversational questions/complaints as trackable tasks.
- internal wrapper text like `Conversation info ...` and `Cortex upstream routing applied ...` was leaking into task detection and summaries.

These were fixed first, but they were **not** the full oracle-bridge problem.

### 2) Poisoned internal oracle session causing compaction stalls
The internal oracle bridge had a long-lived session such as:

- `oracle-prod-bridge-short-119ddc2ee7`

Observed before the fix:

- ~2821 messages in one session
- ~251,985 prompt tokens on a run
- repeated `timed out during compaction`
- repeated `AbortError: Unsubscribed during compaction`
- direct replies could stall behind the sick background bridge path

This happened because internal oracle/bridge turns were getting route-gate wrapper baggage and were reopening the same session repeatedly.

Fixes applied:

- `plugins/cortex-route-gate/index.ts`
  - bypass route/self-model injection for internal oracle executor sessions/prompts
  - quarantine oversized oracle bridge session histories at startup
- quarantined existing oversized session files from `/root/.openclaw/agents/main/sessions/`

### 3) Oracle executor reused stable session IDs derived from prompt hash
The CT101 oracle executor was deriving session IDs from a stable hash of the prompt. Repeated identical prompts therefore reopened the same session forever.

Fixes applied in:

- `deploy/oracle_executor.py`
- `deploy/cortex-vm/oracle_executor.py`

Changes:

- default session mode changed to **ephemeral**
- sticky mode, if explicitly used, is **time-bucketed** instead of unbounded
- retention cleanup added for oracle session artifacts

### 4) False 503s from mixed stdout + multiline JSON
`openclaw agent --json` was emitting plugin log lines to stdout before the JSON payload, and the JSON payload itself was pretty-printed multiline JSON.

The executor originally assumed stdout was a single clean JSON object. Under concurrency this caused valid runs to be misread as invalid payloads and surfaced as 503s.

Fixes applied in:

- `deploy/oracle_executor.py`
- `deploy/cortex-vm/oracle_executor.py`
- `deploy/test_oracle_executor_session_ids.py`

Changes:

- strip ANSI/plugin log prefixes
- parse the **last complete JSON object** from mixed stdout
- added regression test for the exact broken mixed-stdout shape

### 5) Dedicated oracle agent helped prompt size, but exposed a deeper OpenClaw bug
A dedicated `oracle` agent with workspace:

- `/root/clawd/deploy/oracle-workspace-lite`

reduced prompt size substantially and improved latency. But a deeper problem remained:

- `openclaw agent --agent oracle --session-id ...`
  still collapsed into the logical session key:
- `agent:oracle:main`

That meant named-agent runs were effectively sticky even when an explicit session id was provided.

This is the bug that mattered most for the final permanent fix.

### 6) Final root cause: named agents overrode explicit session identity
In OpenClaw runtime code, `--agent <id>` was being treated as an explicit fixed session key via `resolveExplicitAgentSessionKey(...)`, which took precedence over explicit `--session-id` and `--to` routing.

Patched live in OpenClaw dist on CT101 and locally in the same dist files:

- `/usr/lib/node_modules/openclaw/dist/agent-DtkrV7dn.js`
- `/usr/lib/node_modules/openclaw/dist/manager.runtime-BglkCItp.js`

Behavior change:

- if `--session-id` or `--to` is explicitly provided, the agent runtime no longer forces the fixed named-agent session key
- named agents can now use real per-request session IDs

This made the dedicated oracle agent path both:

- **fast** (tiny workspace)
- **safe** (no single endlessly-growing conversation)

---

## Final production configuration

### Bridge/executor behavior

Live CT101 oracle executor now runs with:

- `ORACLE_EXECUTOR_AGENT=oracle`
- `ORACLE_EXECUTOR_LOCAL=true`
- `ORACLE_EXECUTOR_RESET_AGENT_SESSION=false`
- `ORACLE_EXECUTOR_SESSION_MODE=ephemeral`
- `ORACLE_EXECUTOR_REMOTE_SESSION_DIR=/root/.openclaw/agents/oracle/sessions`
- `CT101_WORKDIR=/root/clawd/deploy/oracle-workspace-lite`

### Workspace isolation

Tiny oracle workspace:

- `/root/clawd/deploy/oracle-workspace-lite`

Purpose:

- keep prompt baggage low
- avoid loading the full `/root/clawd` assistant workspace for short oracle turns

### Session hygiene

Oracle session files now land under:

- `/root/.openclaw/agents/oracle/sessions`

Observed post-fix behavior:

- unique small transcript files such as `oracle-prod-bridge-short-...jsonl`
- typical sizes ~2.2K–3.5K after the final fix
- stale `agent:oracle:main` metadata entry was removed with:
  - `openclaw sessions cleanup --agent oracle --enforce --fix-missing`

---

## Validation timeline

### Before final fix
Observed failing states included:

- giant poisoned session (~252k prompt tokens)
- 60s compaction timeouts
- `AbortError: Unsubscribed during compaction`
- invalid executor payload 503s
- gateway closed / gateway connect failed under burst load
- sticky named-agent session behavior

### Intermediate improvements
After dedicated workspace + local execution + reset workaround:

- sequential calls improved to roughly 8–13s
- but burst load could still fail because reset RPC/gateway behavior became the next bottleneck

### Final validation after OpenClaw session-key patch
#### 5-way concurrent burst
Observed live result:

- **5/5 succeeded**
- latencies:
  - 10.92s
  - 9.88s
  - 9.73s
  - 9.70s
  - 9.73s
- average: **9.99s**

#### Mixed soak test
Live test shape:

- 10 sequential requests
- 2 separate 5-way concurrent burst rounds
- total = 20 requests

Observed result:

- **20/20 succeeded**
- **0 failures**
- average successful latency: **7.42s**
- p95: **10.54s**
- max: **13.33s**

#### Post-soak session shape
Observed after soak:

- oracle transcript files remained small
- latest files were roughly **2.2K–3.5K**
- no recurrence of a giant poisoned session

---

## Files changed during this fix wave

### Main assistant reliability fixes
- `plugins/outbound-dedupe/index.ts`
- `plugins/completion-integrity/core.mjs`
- `plugins/completion-integrity/core.test.mjs`
- `plugins/reply-reliability/index.ts`
- `plugins/reply-reliability/index.test.mjs`
- `plugins/reply-reliability/openclaw.plugin.json`
- `plugins/cortex-route-gate/index.ts`
- `plugins/cortex-route-gate/creativity-governor.test.mjs`
- `/root/.openclaw/openclaw.json`

### Oracle executor / CT101 bridge
- `deploy/oracle_executor.py`
- `deploy/cortex-vm/oracle_executor.py`
- `deploy/cortex-vm/oracle-executor.service`
- `deploy/run-oracle-executor.sh`
- `deploy/test_oracle_executor_session_ids.py`
- `deploy/oracle-workspace-lite/*`

### OpenClaw runtime patch (session-key fix)
Patched in installed dist on CT101 and local runtime copy:

- `/usr/lib/node_modules/openclaw/dist/agent-DtkrV7dn.js`
- `/usr/lib/node_modules/openclaw/dist/manager.runtime-BglkCItp.js`

---

## Failed branches intentionally not kept

These were explored and rejected:

- watchdog-style “just make sure it responds” logic as the primary fix
- separate oracle OpenClaw homes with stale/mismatched OAuth state
- persistent reset-before-each-run as the long-term answer
- relying on gateway/websocket behavior for burst stability when local execution was available

They either masked the real issue, added fragility, or failed under load.

---

## Current recommended operating posture

Use the oracle bridge in this form:

- dedicated tiny oracle workspace
- local execution on CT101
- named `oracle` agent
- explicit per-request session ids
- no forced sticky session reuse
- periodic session cleanup in the oracle agent session directory

If behavior regresses, first check:

1. whether the OpenClaw session-key patch is still present in installed dist
2. whether `oracle-executor.service` still has:
   - `ORACLE_EXECUTOR_LOCAL=true`
   - `ORACLE_EXECUTOR_RESET_AGENT_SESSION=false`
3. whether new oracle transcripts are staying small in:
   - `/root/.openclaw/agents/oracle/sessions`

---

## Bottom line

The permanent fix was **not** just executor retries or watchdogs.

The real permanent fix was:

- isolate oracle prompt/workspace cost
- stop internal wrapper contamination
- stop executor JSON misparsing
- stop stable prompt-hash session reuse
- **patch OpenClaw so named agents honor explicit session ids**

That combination removed the original reliability failure mode and restored fast, stable oracle responses under real burst load.
