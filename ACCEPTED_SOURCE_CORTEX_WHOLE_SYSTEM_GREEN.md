# Cortex whole-system-green accepted source

This branch has two explicit layers:

1. **Immutable qualified source:** parent commit `02491ba4370e28bd8bdd6520af6787e456da4c8a`, tree `2acd8be14de43eb158c76b3e31aba613cdce9a91`, archive SHA-256 `59d677bea267426e34d59451b737d8dd7ad6a8aa12f101bb1bfdbd667ec4b5bf`, 2,056 qualified files.
2. **Operational closure overlay:** fail-closed worker-result/handoff, remote-shell admission, watchdog-recovery, and artifact-retention hardening outside the immutable q8 manifest. Deployment-specific configs are represented by public templates; live host/credential material is intentionally excluded.

The evidence directory records the exact finding/gate closure and accepted source hashes. It contains no credentials or provider-response contents.
