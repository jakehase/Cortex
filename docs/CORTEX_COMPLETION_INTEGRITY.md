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
- auto-delivers a completion message after threshold using OpenClaw delivery runtime
- does not treat attempted delivery as closure
- moves to `notification_sent` only after outbound runtime success
- moves to `delivery_confirmed` and `closed` after observed send confirmation path (`message_sent` fallback)
- injects a mandatory done/evidence/what-remains guard into the next prompt while a completed task is still awaiting confirmed user-visible delivery
- recovers stale `running` tasks on gateway restart into `internal_complete` so they can still notify instead of disappearing

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
- stale running task recovery across restart
- deduped/repeated auto-delivery attempts
- subagent completion + next-turn reminder injection
- tool error -> failed state + metric

Run
- `node --test plugins/completion-integrity/core.test.mjs`
