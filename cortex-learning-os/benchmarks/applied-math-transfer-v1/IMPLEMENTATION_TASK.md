# Implementation task: applied-math transfer canary first

Implement only the reusable harness and the smallest one-pair canary before broad task authoring.

Required initial product files:

- schema/validator for policy, matrix, author receipts, frozen outputs, plan, call record, verifier result, analysis, and manifest;
- plan-only CLI that produces a deterministic randomized arm order and refuses missing separation/freeze receipts;
- candidate-output parser for one CommonJS source module with strict byte limits;
- time-bounded, network-disabled hidden verifier runner;
- paired canary runner using existing real Codex worker patterns, fresh sessions, `gpt-5.6-sol`, `xhigh`, no tools, raw event/output preservation, and positive usage checks;
- independent verify CLI that recomputes every digest, reruns hidden tests from candidate bytes, validates call provenance, and fails closed;
- unit/negative tests, including task mutation, pack mutation, prompt mismatch, output mismatch, missing usage, missing worker command, zero runtime, duplicate session, tool event, hidden-test leakage, and manifest omission.

The first real canary must use separately authored and frozen task/treatment outputs. It is not part of the 80-call scored threshold program and cannot support a transfer-efficacy claim.

Do not mutate canonical mastery, transfer registries, production plugin state, or routing configuration. Do not install or claim Lean. Do not broaden to all 264 concepts.
