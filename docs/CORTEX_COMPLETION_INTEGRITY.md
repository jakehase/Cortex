Completion integrity

Purpose
- make silent completion of user-visible tasks much less likely
- track when a user-visible task starts, completes, and whether completion was clearly announced

Implementation
- plugin: `plugins/completion-integrity`
- state: `state/completion-integrity/tasks.json`

Behavior
- detects task-like user requests such as fix/implement/do it/restart/verify/deploy
- ignores recurring cron prompts so background maintenance does not flood the tracker
- tracks them as pending user-visible tasks
- caches the inbound reply route for each session on `message_received`
- when a subagent or successful agent run ends, marks the most recent pending task as completed-awaiting-announcement
- on the next prompt build for that session, injects a hard completion reminder requiring a reply in the pattern: done, evidence, what remains
- if a completed task remains unannounced past the configured threshold, it is escalated as overdue and the next reply is treated as mandatory closure
- after a shorter auto-delivery delay, the plugin attempts a real outbound completion message through OpenClaw's outbound delivery runtime using the cached session route
- only marks tasks as announced after an actual outbound message is sent for that session

Current config
- `autoDeliveryAfterMs` default: `15000`
- `pollIntervalMs` default: `10000`
- `escalationAfterMs` default: `90000`

Limitation
- auto-delivery depends on having a valid cached inbound route for the session
- if runtime delivery fails, the next-turn completion guard still applies as fallback
- it is stronger than the prior version because it now attempts actual outbound completion delivery instead of only relying on prompt injection
