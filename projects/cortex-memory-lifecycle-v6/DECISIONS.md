# Cortex Memory Lifecycle v6 — Decisions

## 2026-10-02

1. Extend the active v5 production code rather than replacing it.
2. Use the clean worktree based on accepted source commit `02491ba4370e28bd8bdd6520af6787e456da4c8a`, overlaid with the exact active `/opt/cortex/current` code.
3. Treat principal-scoped hard deletion as deletion of Cortex projections, caches, ledgers, and replay state; do not silently delete owner source files.
4. Quarantine stores hashes and bounded reason metadata only—never rejected raw payload.
5. Keep promotion review-gated and low-interaction; no autonomous fact promotion.
6. Replace ordinal owner chunk identity with content/duplicate-stable identity and retain predecessor continuity in receipts.
7. Remove sibling/source semantic verification credit; exact record identity is mandatory.
8. Run exactly one focused end-to-end smoke test, then deploy if it passes.
