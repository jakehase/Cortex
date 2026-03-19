Completion integrity

Purpose
- make silent completion of user-visible tasks much less likely
- track when a user-visible task starts, completes, and whether completion was clearly announced

Implementation
- plugin: `plugins/completion-integrity`
- state: `state/completion-integrity/tasks.json`

Behavior
- detects task-like user requests such as fix/implement/do it/restart/verify/deploy
- tracks them as pending user-visible tasks
- when a subagent ends, marks the most recent pending task as completed-awaiting-announcement
- on the next prompt build for that session, injects a hard completion reminder requiring a reply in the pattern: done, evidence, what remains

Limitation
- this does not directly send a message out-of-band at task completion
- instead it enforces announcement on the next runtime turn, especially for async/background completions
- it is still a strong guard against silent success drift
