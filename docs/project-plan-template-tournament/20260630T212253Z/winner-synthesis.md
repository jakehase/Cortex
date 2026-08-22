# <Project Name> Plan

Template source: synthesized winner from `/root/clawd/docs/project-plan-template-tournament/20260630T212253Z/`.

Use this template for serious projects where scope, architecture, agent execution, evidence, or completion truth could become ambiguous.

## Plan metadata

- Project slug: `<project-slug>`
- Plan owner: `<human / agent / team>`
- Created: `<YYYY-MM-DD>`
- Last updated: `<YYYY-MM-DD>`
- Status: `<draft | active | blocked | superseded | completed>`
- Fidelity target: `<prototype | production_slice | parity_for_scope | full_clone | platform | research>`
- Primary stop condition: `<supervisor_green_or_blocker_report | release_candidate_packet_green_or_blocker | all_phase_verifiers_green_or_blocker | parity_matrix_green_or_gap_inventory | boot_proof_green_or_blocker>`

## 1. Working name

<Short project name and stable slug.>

## 2. Decision summary

<One paragraph summarizing what we are doing, why now, where the active work lives, and the next concrete milestone.>

Example shape:

> Build `<project>` as `<fidelity target>` in `<active path>`. The first milestone is `<milestone>`, proven by `<verifier/artifact>`. This plan does not claim `<overclaim>`.

## 3. Core thesis / objective

What are we building, and why does it matter?

- Primary objective: <objective>
- User/operator served: <who benefits>
- Desired outcome: <observable outcome>
- Why existing tools are insufficient: <gap>
- Success changes: <what becomes possible>

## 4. Scope

In scope:

- <surface / subsystem / user outcome>
- <surface / subsystem / user outcome>
- <verification or release outcome>

## 5. Non-goals

Out of scope for this plan:

- <explicit non-goal>
- <thing we are deliberately not building yet>
- <claim we must not make yet>

If the project has a large ambition, separate **eventual ambition** from **current milestone** here.

## 6. Active path / repo layout

Active path:

```text
/root/clawd/<project-or-repo>
```

Important paths:

```text
<path>  # <purpose>
<path>  # <purpose>
<path>  # <purpose>
```

Quarantined or superseded paths:

```text
<path>  # <why it is not active>
```

Path rules:

- Only one active implementation path unless explicitly stated.
- Scratch paths must not become canonical by accident.
- If a path is superseded, move or label it clearly and record why.

## 7. Prior art and existing assets

Prior-art gate decision: `<reuse_existing | extend_existing | adapter_wrapper_only | new_primitive_justified>`

Prior-art command/artifact:

```bash
<command or path to prior-art gate artifact>
```

Existing assets to reuse/extend:

- <asset / repo / primitive>
- <asset / repo / primitive>

Known overlaps or duplication risks:

- <risk>

Decision:

- <how this plan avoids duplicate architecture>

## 8. Target architecture

Describe the architecture at the level needed for agents and reviewers to avoid inventing incompatible versions.

Architecture summary:

<summary>

Subsystems:

- **<Subsystem>** — <responsibility>
- **<Subsystem>** — <responsibility>
- **<Subsystem>** — <responsibility>

Key boundaries:

- <boundary between components>
- <trust/security/data boundary>
- <control-plane vs execution-plane boundary, if relevant>

Interface contracts:

```text
<interface/schema/API/event/file contract>
```

Architecture decisions:

| Decision | Options considered | Chosen option | Reason | Revisit when |
|---|---|---|---|---|
| <decision> | <options> | <choice> | <reason> | <trigger> |

## 9. Surface matrix / subsystem ownership

| Surface / subsystem | Owner / agent squad | Primary files | Allowed write scope | Verifiers | Claim allowed when |
|---|---|---|---|---|---|
| <surface> | <owner> | `<paths>` | `<paths>` | `<tests/checks>` | <condition> |
| <surface> | <owner> | `<paths>` | `<paths>` | `<tests/checks>` | <condition> |

Ownership rules:

- Agents may only edit owned files/surfaces unless a merge/lease gate expands scope.
- Shared files require explicit lease or patch-queue policy.
- Docs/tests/harness-only diffs do not count as product implementation unless the surface is explicitly docs/tests/harness.

## 10. Agent strategy

Agent count target: `<number or staged range>`

Execution placement:

- Control plane: `<host/path>`
- Execution plane: `<host/path>`
- Remote boundary required? `<yes/no>`
- Heavy execution allowed locally? `<yes/no>`

Agent roles:

- planner: <responsibility>
- implementer: <responsibility>
- verifier: <responsibility>
- reviewer: <responsibility>
- release/audit: <responsibility>

Launch gates before using many agents:

- [ ] surface matrix exists
- [ ] file ownership/lease strategy exists
- [ ] verifier catalog exists
- [ ] artifact return contract exists
- [ ] blocker format exists
- [ ] stop condition is machine-checkable or artifact-backed
- [ ] execution plane is verified when needed

## 11. Phases / waves

### Wave 0 — <name>

Goal:

- <goal>

Inputs:

- <input/artifact>

Outputs:

- <artifact/output>

Verifiers:

```bash
<command/check>
```

Stop condition:

```text
<condition>
```

### Wave 1 — <name>

Goal:

- <goal>

Inputs:

- <input/artifact>

Outputs:

- <artifact/output>

Verifiers:

```bash
<command/check>
```

Stop condition:

```text
<condition>
```

### Wave 2 — <name>

Goal:

- <goal>

Inputs:

- <input/artifact>

Outputs:

- <artifact/output>

Verifiers:

```bash
<command/check>
```

Stop condition:

```text
<condition>
```

Add more waves only when needed. Prefer fewer, clearer phases over a giant vague roadmap.

## 12. Verifier and evidence contract

Required verifiers:

```bash
<command>
<command>
```

Evidence artifacts:

```text
<artifact path>  # <what it proves>
<artifact path>  # <what it proves>
```

Claim matrix:

| Claim | Required evidence | Verifier | Allowed wording |
|---|---|---|---|
| <claim> | <artifact> | <check> | <bounded wording> |
| <claim> | <artifact> | <check> | <bounded wording> |

A claim is green only when:

- <condition>
- <condition>

A blocker must be written when:

- <condition>

## 13. Capability, safety, and external-action policy

Capability matrix:

| Capability | Default | Requires approval? | Audit artifact | Revocation / rollback |
|---|---|---|---|---|
| read workspace | allowed | no | <artifact/log> | n/a |
| write workspace | <allowed/scoped> | <yes/no> | <artifact/log> | <rollback> |
| external read | <allowed/scoped> | <yes/no> | <artifact/log> | n/a |
| external write/send/deploy | blocked by default | yes | <approval artifact> | <rollback/mitigation> |

Safety rules:

- No external user-visible action without explicit approval.
- No destructive action without explicit approval and rollback/backup plan.
- No secrets in logs, plans, artifacts, or memory unless explicitly intended and protected.
- If safety and completion conflict, stop and write a blocker.

## 14. Artifacts and replay commands

Canonical artifact root:

```text
/root/clawd/<project>/artifacts/<run-id-or-latest>
```

Expected artifacts:

```text
surface_matrix.json
work_graph.json
run_contract.json
verifier_catalog.json
execution_summary.json
claim_gate.json
blocker_report.json
release_packet.json
artifact_bundle_manifest.json
```

Replay commands:

```bash
<command>
<command>
```

Artifact integrity requirements:

- <checksum/bundle/replay requirement>
- <artifact return requirement>

## 15. Stop condition

The project/phase stops when:

```text
<supervisor_green_or_blocker_report | release_candidate_packet_green_or_blocker | all_phase_verifiers_green_or_blocker | parity_matrix_green_or_gap_inventory | boot_proof_green_or_blocker>
```

If stopped by blocker, write:

```text
<blocker artifact path>
```

Completion is not allowed merely because:

- agents finished,
- code exists,
- a command exited zero without claim mapping,
- a benchmark is mechanically green for a narrower claim,
- a plan says the work should be done.

## 16. Truth boundary

This plan may claim:

- <bounded claim>

This plan may **not** claim yet:

- <overclaim to avoid>
- <overclaim to avoid>

Truth layers to keep separate:

- planning/scaffolding,
- product implementation,
- tests/verifiers,
- mechanical green,
- threshold pass,
- release candidate,
- production readiness,
- full parity/full clone/full OS/native/public claims.

## 17. Risks and mitigations

| Risk | Why it matters | Mitigation | Evidence mitigation works |
|---|---|---|---|
| <risk> | <reason> | <mitigation> | <artifact/check> |
| <risk> | <reason> | <mitigation> | <artifact/check> |

Common risks to consider:

- ambiguous scope,
- duplicate architecture,
- fake-green benchmark,
- 100-agent collision/chaos,
- external-action safety,
- stale memory/live-state confusion,
- no rollback path,
- verifier too weak for claim,
- product parity overclaim.

## 18. Open questions

| Question | Why it matters | Owner | Needed by | Resolution artifact |
|---|---|---|---|---|
| <question> | <reason> | <owner> | <phase/date> | <artifact> |

Do not block implementation on questions that can safely be answered during a later wave. Do block if the answer changes safety, architecture, active path, or stop condition.

## 19. Immediate next milestone

Next milestone:

- <specific outcome>

Next action:

```bash
<command or implementation step>
```

Done when:

- <observable condition>

## 20. Plan maintenance

Update this plan when:

- scope changes,
- architecture changes,
- active path changes,
- a phase completes,
- a blocker changes the route,
- verifier truth changes,
- agent count/execution placement changes,
- the user makes a strategic decision.

Memory/update path:

```text
/root/clawd/memory/projects/<project>.md
```

Plan truth boundary:

This `plan.md` is a planning and coordination artifact. It is not implementation proof. Completion claims require the evidence and verifiers named above.
