# Synthetic Labor OS v16 Iteration 10 Patch Boundary

This iteration is a remote Codex patch-proposal run. Its output is a
reviewable unified diff, not a repository mutation.

## Operator Boundary

Remote Codex may:

- inspect the bounded context provided for the work item
- draft a small unified diff for the allowed target path
- return the proposal as an artifact for deterministic review

Remote Codex must not:

- apply the patch to the worktree
- merge a branch or commit changes
- publish, deploy, or send artifacts externally
- claim completion beyond the returned proposal

## Dry-Run Meaning

The Synthetic Labor OS can write the returned diff to an artifact and run a
dry-run check such as `git apply --check`. A green dry-run proves only that the
