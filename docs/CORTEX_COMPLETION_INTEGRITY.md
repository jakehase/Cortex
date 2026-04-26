Completion integrity / trust hardening

Purpose
- make silent completion of user-visible tasks materially harder
- keep user-visible work on an explicit state machine instead of loose booleans
- require confirmed delivery progression, not just an attempted send
- add validation only where trust tier says it matters
- leave machine-readable evidence behind

Implementation
- plugin: `plugins/completion-integrity`
- core: `plugins/completion-integrity/core.mjs`
- tests: `plugins/completion-integrity/core.test.mjs`
- state: `state/completion-integrity/tasks.json`
- routes: `state/completion-integrity/routes.json`
- metrics: `state/completion-integrity/metrics.json`
- event log: `state/completion-integrity/events.ndjson`

Hard task state machine
- `pending` - task detected but not yet executing
- `running` - task execution has started
- `internal_complete` - runtime/subagent says work finished internally
- `notification_sent` - completion notice was actually emitted through outbound delivery runtime
- `delivery_confirmed` - completion notice was observed on the outbound send/confirmation path
- `closed` - completion lifecycle is done
- `failed` - task execution or delivery/validation path failed hard

Task contract model
- important execution tasks now carry a persisted **Task Contract** in state
- contract fields:
  - requested fidelity
  - requested scope
  - stop condition
- contract proof is required before validator pass for important grounded/campaign/parity work

Fidelity lattice
- `prototype`
- `production_slice`
- `parity_for_scope`
- `full_clone`

This is treated as an ordered lattice, not vibe text.
The runtime now records an inferred requested fidelity and injects it back into the prompt contract.
Clone requests default to `full_clone`.

Trust tiers / policy
- `background`: recurring cron-like work, excluded from user-visible tracking
- `normal`: lightweight user-visible tasks; light validation only
- `important`: higher-risk or reliability-sensitive work (`fix`, `implement`, `deploy`, `restart`, `verify`, `debug`, `recover`, etc.); strict validator gate before auto-delivery

Behavior
- detects user-visible task prompts and ignores cron/background prompts
- records the inbound route for later auto-delivery
- moves tasks to `running` on prompt start
- moves tasks to `internal_complete` when agent/subagent work finishes successfully
- runs validator pass automatically for important tasks; failed validator keeps task in `internal_complete`
- for important implementation/build tasks, injects an **objective grounding** checklist before execution:
  - identify the exact anchor artifact/message/roadmap being followed
  - identify the target repo/path/codebase being changed
  - identify whether the work is product code vs scaffolding/docs/tests
  - do not claim feature implementation unless the diff touches real product-surface files
- when the inbound message is a **reply** and the replied message text is present, injects a **reply-thread grounding** anchor:
  - treat the replied message as the primary scope anchor before repo search or memory search
  - do this even for conversational reply questions, not only implementation tasks
  - require completion summaries to include `Reply anchor: ...` for important grounded implementation tasks
  - prevent ambiguous prompts like “this”, “continue”, “previous roadmap”, or “phases 1-3” from drifting to unrelated phase-shaped docs
- when the replied message is clearly high-signal (canonical status summary, remaining surfaces, durable decision, strong preference), auto-promote a distilled note into `memory/YYYY-MM-DD.md` with dedupe state under `state/completion-integrity/reply-anchor-memory.json`
- when that high-signal reply clearly names a known active project (for example Mailchimp), also update `memory/projects/<project>.md` as the canonical active-project memory with latest status, changed surfaces, remaining surfaces, lessons, and provenance; project-state metadata is tracked under `state/completion-integrity/project-memory.json`
- when the prompt asks for a **1:1 / full / exact clone**, injects a **clone parity contract**:
  - interpret clone requests as parity-first, not MVP-first
  - reject completions that describe the result as a prototype, first-pass, vertical slice, scaffold-only build, or mini version
  - require explicit parity proof before validator pass
- when the prompt is a long-horizon roadmap/program/phase/campaign task, injects a **campaign runtime contract**:
  - treat the task as a persistent campaign, not a one-shot pass
  - require explicit campaign mode and supervisor status in completion/blocker summaries
  - prevent “worker stopped after one pass while supervisor is still red” from counting as valid closure
- when the scope implies multiple surfaces/programs/phases, injects a **surface matrix contract**:
  - require a machine-readable surface matrix/checklist
  - require supervisor truth to be derived from that matrix, not only file presence
- auto-delivers a completion message after threshold using OpenClaw delivery runtime
- does not treat attempted delivery as closure
- moves to `notification_sent` only after outbound runtime success
- moves to `delivery_confirmed` and `closed` after observed send confirmation path (`message_sent` fallback)
- injects a mandatory done/evidence/what-remains guard into the next prompt while a completed task is still awaiting confirmed user-visible delivery
- recovers stale `running` tasks on gateway restart into `internal_complete` so they can still notify instead of disappearing

Objective grounding validator
- important implementation/build tasks now require short grounding proof in their completion summary before validator pass:
  - `Anchor: ...`
  - `Reply anchor: ...` when the current message is a reply and the replied message sets scope
  - `Target path:` or `Target repo:` or `Codebase:`
  - `Diff scope:` / `Implementation surface:` / `Product files:` (or explicit `scaffolding only`)
- this does **not** prove semantic correctness by itself, but it blocks the easy failure mode where scaffolding or docs work is reported as feature implementation without any explicit grounding proof

Task contract validator
- important grounded/campaign/parity tasks now additionally require:
  - `Fidelity: ...`
  - `Scope: ...`
  - `Stop condition: ...`
- this prevents silent scope-shrinkage or fidelity downgrades during execution

Clone parity validator
- important tasks that explicitly ask for a `1:1`, `full`, or `exact` clone now additionally require:
  - `Parity status: full`
  - `Surface coverage: ...`
  - `Parity evidence:` / `Parity checks:` / `Parity tests:`
  - `Remaining gaps: ...`
- validator fails if the completion summary also frames the result as a `prototype`, `first-pass`, `vertical slice`, `MVP`, `mini version`, `working slice`, or `partial parity`
- for structured blocker stops, clone/parity tasks may instead report:
  - `Parity status: blocked|incomplete|not full`
  - plus a valid blocker report under the campaign runtime rules

Campaign runtime validator
- campaign-required tasks now require:
  - `Campaign mode: persistent`
  - `Supervisor status: green` for completion, or
  - `Supervisor status: red` + `Blocker: ...` + `Next action: ...` for a blocker stop
- if the supervisor is red and no blocker report is present, validator fails with a campaign-stop error

Surface matrix validator
- multi-surface/program/phase tasks now require:
  - `Surface matrix: ...` or `Surface checklist: ...`
  - `Surface matrix status: all_complete|partial|blocked`
- full clone/parity claims require `Surface matrix status: all_complete`
- blocker-mode campaign stops may use `Surface matrix status: blocked`

Machine-readable metrics
`state/completion-integrity/metrics.json` includes:
- `completion_to_notification_latency_ms`
- `completion_to_delivery_confirmed_latency_ms`
- `silent_success_count`
- `duplicate_reply_count`
- `false_done_count`
- `tool_error_count`
- `recovery_success_count`
- validator run/failure counters
- per-state task counts

Regression coverage
Tests cover:
- normal agent completion -> auto-delivery -> confirmation -> close
- important-task validator gating
- objective-grounding injection + validator proof requirement for important implementation tasks
- reply-thread grounding injection + explicit `Reply anchor:` validator requirement
- conversational reply questions still get reply-thread grounding and high-signal reply anchors are auto-promoted into daily memory without duplicate entries
- clone parity injection + rejection of prototype-style completions for `1:1 clone` tasks
- task-contract injection + proof requirement (`Fidelity`, `Scope`, `Stop condition`)
- campaign runtime injection + blocker-only stop rule when supervisor stays red
- surface matrix injection + matrix-status truth gating
- stale running task recovery across restart
- deduped/repeated auto-delivery attempts
- subagent completion + next-turn reminder injection
- tool error -> failed state + metric

Run
- `node --test plugins/completion-integrity/core.test.mjs`
