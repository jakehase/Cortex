# Business/asset plan template

Candidate: `19-business-lightweight`

## Use when

Best for low-interaction business/data/product ideas with validation and operating model.

## Working name

<Short project name and stable slug.>

## Decision summary

<One paragraph: what we are doing, why now, active path, and the next milestone.>

## Core thesis / objective

<What are we building, who/what it serves, and what would be different if it succeeds?>

## Template emphasis

Best for low-interaction business/data/product ideas with validation and operating model.

Best at:

- Customer/user problem
- Asset/data source
- Packaging
- Low-touch ops

## Scope

In scope:

- <surface / subsystem / user outcome>
- <surface / subsystem / user outcome>

## Non-goals

Out of scope:

- <explicit non-goal>
- <claim we must not make yet>

## Active path / repo layout

Active path:

```text
/root/clawd/<project-or-repo>
```

Important paths:

```text
<path>  # <purpose>
```

## Prior art and existing assets

Prior-art gate decision: `<reuse_existing | extend_existing | adapter_wrapper_only | new_primitive_justified>`

Existing assets to reuse/extend:

- <asset>

## Target architecture

<Architecture summary with subsystem boundaries and integration points.>

## Subsystem ownership matrix

| Subsystem | Owner / agent squad | Primary files | Verifiers | Claim allowed when |
|---|---|---|---|---|
| <subsystem> | <owner> | `<paths>` | `<tests/checks>` | <condition> |

## Agent strategy

Agent count target: `<number or staged range>`

Execution plane:

- Control plane: `<host/path>`
- Execution plane: `<host/path>`

Rules:

- owned files/surfaces only
- verifier evidence required
- blockers written as artifacts

## Phases / waves

### Wave 0 — <name>

Goal: <goal>

Outputs:

- <artifact>

Verifiers:

- `<command/check>`

Stop condition: `<condition>`

## Verifier and evidence contract

Required verifiers:

```bash
<command>
```

A claim is green only when:

- <condition>

## Artifacts and replay commands

Canonical artifact root:

```text
/root/clawd/<project>/artifacts/<run-id-or-latest>
```

Replay:

```bash
<command>
```

## Stop condition

The project/phase stops when:

```text
<supervisor_green_or_blocker_report | release_candidate_packet_green_or_blocker | all_phase_verifiers_green_or_blocker | parity_matrix_green_or_gap_inventory>
```

## Truth boundary

This plan may claim:

- <bounded claim>

This plan may **not** claim yet:

- <overclaim to avoid>

## Business/operating model

- data/asset source
- packaging
- distribution
- low-touch ops
- monetization hypothesis
- validation

## Risks and mitigations

| Risk | Why it matters | Mitigation | Evidence mitigation works |
|---|---|---|---|
| <risk> | <reason> | <mitigation> | <artifact/check> |

## Immediate next milestone

Next milestone: <specific outcome>

Done when:

- <observable condition>

## Candidate truth boundary

This candidate is a planning template variant, not an implementation plan for a specific project.
