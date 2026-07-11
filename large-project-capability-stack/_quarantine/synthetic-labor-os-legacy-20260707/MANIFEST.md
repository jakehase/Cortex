# Synthetic Labor OS legacy quarantine — 2026-07-07

Active path: `apps/synthetic-labor-os`
Quarantine root: `_quarantine/synthetic-labor-os-legacy-20260707`

Reason: shrink the worse-Codex layer. SLOS v1-v18 pilots/tournaments and direct Codex work-item wrappers are historical replay/audit material, not active runtime surface.

Recovery: move a listed file back to its `originalPath` and re-run the relevant tests before using it. Do not treat quarantined scripts as current control-plane product.

## Moved files

- `apps/synthetic-labor-os/codex-agent-work-item.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/codex-agent-work-item.mjs` (`57ec6677635d`)
- `apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs` (`56b980705d15`)
- `apps/synthetic-labor-os/v1-pilot.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v1-pilot.mjs` (`4365eaead7f2`)
- `apps/synthetic-labor-os/v10-scale-smoke.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v10-scale-smoke.mjs` (`e3c62b14bcdd`)
- `apps/synthetic-labor-os/v11-release-bundle.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v11-release-bundle.mjs` (`2541e87b5941`)
- `apps/synthetic-labor-os/v12-fresh-replay.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v12-fresh-replay.mjs` (`0502bcf4110a`)
- `apps/synthetic-labor-os/v13-operator-doctor.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v13-operator-doctor.mjs` (`ca7cb641dfad`)
- `apps/synthetic-labor-os/v14-multi-job-smoke.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v14-multi-job-smoke.mjs` (`2651a46c2108`)
- `apps/synthetic-labor-os/v15-release-candidate.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v15-release-candidate.mjs` (`ec5edd2e5db6`)
- `apps/synthetic-labor-os/v16-iteration-tournament.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v16-iteration-tournament.mjs` (`baa7cd92ea66`)
- `apps/synthetic-labor-os/v16-iteration-worker.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v16-iteration-worker.mjs` (`686493779f1b`)
- `apps/synthetic-labor-os/v17-role-catalog.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v17-role-catalog.mjs` (`273af9ffa45b`)
- `apps/synthetic-labor-os/v17-role-implementation.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v17-role-implementation.mjs` (`4abbf2861fe6`)
- `apps/synthetic-labor-os/v17-role-tournament-remote.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v17-role-tournament-remote.mjs` (`095316fee468`)
- `apps/synthetic-labor-os/v17-role-tournament.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v17-role-tournament.mjs` (`495b67fd26ea`)
- `apps/synthetic-labor-os/v17-role-verifier.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v17-role-verifier.mjs` (`179b629a3e47`)
- `apps/synthetic-labor-os/v18-whole-os-catalog.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v18-whole-os-catalog.mjs` (`bf0c7a2b0a7d`)
- `apps/synthetic-labor-os/v18-whole-os-implementation.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v18-whole-os-implementation.mjs` (`3dd2f0957474`)
- `apps/synthetic-labor-os/v18-whole-os-tournament-remote.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v18-whole-os-tournament-remote.mjs` (`dab316312517`)
- `apps/synthetic-labor-os/v18-whole-os-tournament.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v18-whole-os-tournament.mjs` (`495325036fad`)
- `apps/synthetic-labor-os/v18-whole-os-verifier.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v18-whole-os-verifier.mjs` (`1aa4262868f3`)
- `apps/synthetic-labor-os/v2-remote-pilot.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v2-remote-pilot.mjs` (`489631d95187`)
- `apps/synthetic-labor-os/v3-remote-codex-pilot.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v3-remote-codex-pilot.mjs` (`07ded1251ff5`)
- `apps/synthetic-labor-os/v4-remote-patch-pilot.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v4-remote-patch-pilot.mjs` (`0d2e285926df`)
- `apps/synthetic-labor-os/v5-apply-pilot.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v5-apply-pilot.mjs` (`fdece1deecce`)
- `apps/synthetic-labor-os/v6-provenance-chain.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v6-provenance-chain.mjs` (`109fcdcb7b28`)
- `apps/synthetic-labor-os/v7-replay-rollback-audit.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v7-replay-rollback-audit.mjs` (`d8cbad04dcb1`)
- `apps/synthetic-labor-os/v8-e2e-demo.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v8-e2e-demo.mjs` (`a52d591e4aa7`)
- `apps/synthetic-labor-os/v9-finished-claim-report.mjs` → `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/v9-finished-claim-report.mjs` (`598a6a4c4a68`)

## Truth boundary

Recoverable quarantine only. These files are not deleted, not active defaults, and not proof that all legacy SLOS/Codex duplication has been removed.
