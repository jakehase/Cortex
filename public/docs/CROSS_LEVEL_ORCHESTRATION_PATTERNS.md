# Cross-Level Orchestration Patterns (Implemented)

Source: cortex_server/routers/nexus.py

## 1) Brainstorm chain (forced)
- Trigger: brainstorm-style prompts
- Route: `brainstorm_chain_forced`
- Chain: Dreamer (L13) → Muse (L29) → Synthesist (L32)

## 2) Coding chain (forced)
- Trigger: implementation/refactor/bugfix/test coding intent
- Route: `coding_chain_forced`
- Chain: Lab (L4) → Architect (L9) → Validator (L34) → Forge (L27) → Council (L15)
- Resilience: if L9 unavailable, fallback to Council+Synthesist (`coding_fallback`)

## 3) Incident chain (forced)
- Trigger: incident/outage/rollback/on-call intent
- Route: `incident_chain_forced`
- Chain: Sentinel (L21) → Seer (L30) → Council (L15) → Diplomat (L18) → Chronos (L14)

## 4) Research chain (forced)
- Trigger: research/sources/evidence intent
- Route: `research_chain_forced`
- Chain: Ghost (L2) → Librarian (L7) → Mnemosyne (L22) → Oracle (L5) → Validator (L34)

## 5) Architecture chain (forced)
- Trigger: architecture/system-design/blueprint prompts
- Route: `l9_chain_forced`
- Chain: Architect (L9) → Council (L15) → Synthesist (L32) → Validator (L34)

## 6) Fast factual path
- Trigger: low-risk simple QA
- Route: `qa_fastlane`

## 7) Complexity-gated deep reasoning path
- Trigger: multi-constraint/tradeoff/strategy/architecture complexity
- Route: `semantic_orchestration` with complexity gate and stronger reasoning lane
- L9 auto-activation: adds Architect (L9) as `l9_complexity` when complexity gate is hard

## 8) Creativity governor overlay (implemented in route gate)
- Trigger: novelty / originality / orthogonal / brainstorm-style user requests
- Overlay behavior in `plugins/cortex-route-gate/index.ts`:
  - quarantines recent anchor terms from recent prompts
  - honors explicit negative constraints like `not memory`
  - ensures Dreamer (L13) + Muse (L29) + Synthesist (L32) + Validator (L34)
  - injects a `CORTEX_CREATIVITY_GOVERNOR` prompt contract with anti-anchor checks and distance buckets
- Goal: stop recency anchoring so novelty requests are not answered as mere continuations of the last thread

## Verification
- `GET /nexus/orchestrate?query=brainstorm:...` → `brainstorm_chain_forced`
- `GET /nexus/orchestrate?query=Implement bug fix and add unit tests...` → `coding_chain_forced`
- `GET /nexus/orchestrate?query=Need a system design blueprint...` → `l9_chain_forced`
- `GET /nexus/orchestrate?query=SEV1 incident service down rollback now` → `incident_chain_forced`
- `GET /nexus/orchestrate?query=Research this with sources and evidence` → `research_chain_forced`
- `GET /nexus/orchestrate?query=Optimize a multi-step strategy under constraints...` → `semantic_orchestration` + `l9_complexity`
