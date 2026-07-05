# Synthetic Labor OS v4 Patch Proposal Boundary

Synthetic Labor OS v4 treats a remote Codex result as a reviewable patch
proposal, not as an applied change. The remote worker may inspect the bounded
context pack and return a standard unified diff for an explicitly allowed path.

The OS may then dry-run that diff with `git apply --check`, write the returned
proposal to artifacts, and record proof that the worktree was not changed by the
verification step. A green v4 proof means the proposal is ready for human or
operator review.

The boundary is intentionally narrow:

- remote Codex proposes a patch only;
- the OS verifies the patch without applying it;
- no merge, publish, deployment, or external send occurs in the pilot;
- implementation credit requires a later explicit human or operator step.
