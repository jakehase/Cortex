# Decision tree

## Start here

### 1. Is the user asking for information only?
- Yes: answer directly or do lightweight research if needed.
- No: continue.

### 2. Is the work entirely inside the workspace?
- Yes: prefer local file/tool actions.
- No: continue.

### 3. Is the request mainly about an external system of record?
- Yes: use the smallest appropriate connector or tool.
- No: continue.

### 4. Does the request leave the machine in a meaningful way?
- Yes: check approval unless clearly requested.
- No: continue.

### 5. Is the task heavy, long-running, or execution-plane shaped?
- Yes: apply remote-boundary discipline.
- No: continue.

### 6. Is there a more specific local skill that fits better?
- Yes: use that skill.
- No: proceed with the minimal direct workflow.

## Routing reminders

- chat summary first, tool second, only when the task is actually answer-only
- internal workspace before external connector
- read before write
- canonical artifact before chat memory when current state matters
