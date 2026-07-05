# Synthetic Labor OS v12 Fresh Replay Patch Proposal

Job id: `slos-v12-fresh-replay-20260629T194139827Z`

This document records the review boundary for a bounded remote Codex patch proposal in the Synthetic Labor OS v12 fresh replay flow.

## Proposal boundary

- Remote Codex may produce a standard unified diff for a narrow target path.
- The OS may dry-run the returned diff and record whether it passes patch validation.
- A successful dry-run is evidence that the proposal is syntactically reviewable, not that it has been applied.
- No apply, merge, publish, deploy, or external send occurs without a later explicit human/operator step.

## Truth boundary

The returned patch proposal is an input to review. It is not implementation credit, merge approval, release approval, or publication approval.
