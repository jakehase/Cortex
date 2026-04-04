# Mailchimp true 1:1 gap-closure plan — 2026-04-04

## Grounding
- Reply anchor: user said **"Do it"** immediately after the strict 1:1 audit.
- Primary anchor: `docs/MAILCHIMP_1TO1_AUDIT_2026-04-04.md`
- Target path: `/root/clawd/mailchimp-clone`
- Fidelity target: `full_clone`
- Current truthful state: `parity_for_scope`, not full Mailchimp equivalence.

## Scope lanes
1. **UI parity**
   - rich client interaction model
   - deeper editor behavior
   - browser-realistic journeys for all current-product families
2. **Workflow parity**
   - multi-step flows matching current Mailchimp behavior more closely
   - stronger review / approval / scheduling / reporting linkages
3. **Data-model parity**
   - replace simplistic local state assumptions with a more realistic domain model
4. **Provider / integration parity**
   - move beyond fixture-only sync/auth realism
   - deepen connector and delivery behavior
5. **Operational parity**
   - auth, session, persistence, jobs, and analytics realism

## Immediate first slice started in this pass
This pass starts with the most actionable honesty-improving gap from the audit:

- add **dedicated browser-proof coverage** for the newly added current-product families:
  - campaign AI / experimentation / predictive optimization
  - website builder + website AI
  - automation AI + omnichannel
  - content depth
  - integration detail auth/config/mapping/remediation

Why first:
- the audit explicitly called out missing dedicated browser proof for these surfaces
- this does not falsely claim 1:1, but it tightens evidence around real user-visible behavior
- it creates a better foundation before deeper architectural replacement work

## Sequencing after this slice
### Phase 1 — evidence hardening
- dedicated browser proof for current-product families
- expand browser assertions around richer interactive behavior
- keep parity claims tied to observed browser evidence

### Phase 2 — frontend parity
- introduce richer client-side behavior where current HTML/form flows are too shallow
- focus first on campaign editor and website builder interaction depth

### Phase 3 — backend realism
- replace file-backed persistence and simplistic job execution with production-grade equivalents
- harden session/auth/reset semantics

### Phase 4 — delivery, AI, and integration realism
- replace heuristic-only AI behavior where parity claims currently overreach
- deepen integration sync/auth behavior and reporting provenance
- make delivery/reporting less synthetic

## Stop condition
Do not call this 1:1 complete until all five lanes are green and evidence is browser-backed plus backend-verified.
