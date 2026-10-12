# Cortex Post-Audit Repair — DECISIONS

## Decisions

## 2026-10-11 — Bind repair scope to the October 11 audit

- **Decision:** Treat every finding in the immediately preceding audit report as in scope.
- **Reason:** Jake explicitly instructed, “Fix everything you listed.”
- **Supersedes:** Any narrower assumption that only routing, memory, or deployment provenance should be repaired.

## 2026-10-11 — Preserve later approved decisions

- **Decision:** Extend the accepted October 2 release with the later approved September–October behavior; do not roll back wholesale to August.
- **Reason:** The current approved state includes PMHNP OAuth, xhigh default reasoning, Cortex L2 browsing, memory lifecycle v6, current Oracle routing, and Claude Cowork integrations.

## 2026-10-11 — Establish one clean implementation path

- **Decision:** Use `/root/clawd/_worktrees/cortex-repair-20261011` as the canonical repair worktree, based on the accepted October 2 source and reconciled with the exact live delta.
- **Reason:** The root workspace is heavily dirty/diverged and the live release no longer matches either the accepted source or root workspace.

## 2026-10-11 — Restore real release immutability

- **Decision:** Future live changes must deploy as a new immutable release with a source commit, manifest, test receipt, rollback packet, and accepted remote ref; no more in-place mutation of the current release.
- **Reason:** Reproducibility and rollback are currently broken.

## 2026-10-11 — Keep heavy qualification off the control plane

- **Decision:** Run repo-scale/full-suite qualification on Hetzner and keep CT101 limited to control-plane work, focused smokes, deployment, supervision, and artifact consumption.
- **Reason:** Standing execution-plane boundary and control-plane responsiveness requirements.
