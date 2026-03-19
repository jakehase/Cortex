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
- when a subagent or successful agent run ends, marks the most recent pending task as completed-awaiting-announcement
- on the next prompt build for that session, injects a hard completion reminder requiring a reply in the pattern: done, evidence, what remains
- if a completed task remains unannounced past the configured threshold, it is escalated as overdue and the next reply is treated as mandatory closure
- only marks tasks as announced after an actual outbound message is sent for that session
- warns on gateway startup if overdue completed tasks are still sitting unannounced

Current config
- `escalationAfterMs` default: `90000`

Limitation
- this still does not directly send a message out-of-band at task completion
- instead it enforces announcement on the next runtime turn and escalates overdue silent completions until a real outbound reply happens
- it is stronger than the prior version because it no longer treats prompt injection alone as equivalent to user notification
