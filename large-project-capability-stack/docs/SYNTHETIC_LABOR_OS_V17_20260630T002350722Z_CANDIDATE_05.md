# Synthetic Labor OS v17 Release-Candidate Proof Boundary Runbook

## Purpose

Use this runbook when evaluating a Synthetic Labor OS role-agent tournament
candidate as release-candidate input. It helps operators separate what the
candidate actually changed from what its agents asserted, checked, assumed, or
left outside the proof boundary.

This is a review aid, not an automated gate. A candidate can make release
selection easier to reason about; it cannot prove production readiness unless
the supporting artifacts actually demonstrate that readiness.

## Role-Agent Handoff Contract

Each role-agent handoff should preserve the boundary between intent, change,
evidence, and judgment:

- Strategist: states the intended improvement, allowed patch surface, expected
  evidence, known risks, and non-goals.
- Implementer: changes only the approved surface, keeps the diff reviewable, and
  records the checks that were actually run.
- Reviewer: compares claims against the diff and artifacts, reports gaps before
  praise, and distinguishes defects from unproven assumptions.
- Operator: selects, rejects, or pauses the candidate only after evidence and
  residual risk are visible.

A handoff is weak if the next role must infer scope, recreate missing evidence,
or translate confident language into concrete checks.

## Proof Boundary Rules

Treat every candidate claim as bounded by named evidence.

- A check counts as evidence only when the command, artifact, review, or
  inspection is named.
- "No failures observed" is not test evidence unless the relevant check was run.
- A clean diff proves only that the diff is small and inspectable; it does not
  prove runtime behavior, deployment safety, security posture, or compatibility.
- Claims about CI, production, external services, policy compliance, or rollback
  must identify the source of that knowledge.
- Unknowns should remain explicit. Do not smooth missing proof into release
  language such as "ready", "safe", or "verified".

When evidence is unavailable, prefer "not checked" over a weaker synonym that
sounds reassuring.

## Release-Candidate Readiness Checklist

Before selecting a candidate, confirm:

- Scope: the patch changes only files and behavior allowed by the tournament
  brief.
- Reviewability: the diff is small enough to inspect in one pass and avoids
  unrelated refactors or generated bulk.
- Evidence: each material claim names the command, artifact, or manual review
  that supports it.
- Reproducibility: another operator can rerun or inspect the stated evidence
  without relying on private context.
- Risk: operational impact, user impact, and repository-policy impact are stated
  without extrapolating beyond the patch.
- Rollback: rejection or revert is obvious, especially for documentation-only
  candidates.
- Documentation fit: the wording improves operator understanding without
  inventing process that current tooling cannot enforce.

If an item is not applicable, mark it that way. If it is applicable but unchecked,
the candidate should carry that gap forward instead of hiding it.

## Stop Conditions

Pause selection and request more evidence when:
