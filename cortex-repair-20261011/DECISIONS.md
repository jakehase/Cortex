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

## 2026-10-11 — Isolate nested Oracle execution

- **Decision:** Run the ordinary Cortex API as unprivileged `cortex` with no capabilities or OpenClaw filesystem writes. Move its two mutable SQLite paths into `/var/lib/cortex`. Reuse the existing Oracle executor as an authenticated loopback helper with response-bound receipts and only the Oracle session/auth-profile write paths.
- **Reason:** Oracle must keep using the approved OpenClaw OAuth/profile and signed principal flow without granting the entire API root and broad OpenClaw writes.
- **Deferred boundary:** Moving the root-owned OAuth profile to a dedicated non-root identity requires a separately approved credential migration.

## 2026-10-11 — Reconcile canonical inference policy

- **Decision:** The active policy is PMHNP OAuth approved September 25, 2026; `gpt-5.6-sol`; default `xhigh`; provider-default service tier with no forced Fast/priority override; safe mode and external-write restrictions remain enabled.
- **Supersedes:** Personal OAuth, default `ultra`, and forced Fast/priority rules. They remain explicit historical entries rather than being erased.

## 2026-10-11 — Gate rather than disable requested attachments

- **Decision:** Preserve requested image/document parsing, label attachment contents as untrusted data, and block attachment-driven external-write tool calls unless authorization appears in user-authored text and existing write gates also pass.
- **Reason:** Globally disabling attachment tool inputs would break approved workflows; policy isolation can reduce prompt-injection impact without claiming parser-level isolation.
