---
name: clawd-git-auth-and-export-recovery
description: Cortex-first local skill for diagnosing git authentication and export-sync failures in this workspace. Use for failed pushes, local export commits that did not reach the remote, credential-path checks, remote verification, and honest reporting of local-save versus remote-sync state.
---

# clawd-git-auth-and-export-recovery

Use this skill when git state looks half-done: local commits exist, but the remote truth does not.

## Use this skill for

- repeated git push auth failures
- export jobs that commit locally but fail remotely
- verifying whether a backup or mirror actually left the machine
- separating local durability from remote durability

## Workflow

1. Identify the repo and remote.
2. Verify local state.
   - current branch
   - recent commits
   - remote URL
3. Verify auth path.
   - credential helper
   - token or SSH path
   - whether the failing remote expects HTTPS or SSH
4. Attempt a safe diagnostic.
5. Report the truth clearly:
   - local commit status
   - remote push status
   - blocker
   - next auth fix

## Guardrails

- Do not print secrets into chat.
- Do not call a backup complete when the push failed.
- Preserve the exact git error message when it matters.
- Distinguish auth failure from network failure from permission failure.

## Output shape

Use this order:
1. Local state
2. Remote state
3. Exact blocker
4. Next fix
