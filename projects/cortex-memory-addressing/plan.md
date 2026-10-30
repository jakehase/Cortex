# Cortex structural memory addressing adaptation

## 1. Working name

Cortex Structural Memory Addressing, MemPalace-informed production slice.

## 2. Core thesis / objective

Borrow the strongest reusable MemPalace idea without replacing Cortex: make existing governed memories directly addressable by project, subject/person, and topic before ranking. Cortex already has stronger temporal truth, contradiction handling, principal isolation, source lineage, canonical project memory, and lifecycle durability. The useful delta is a small extension to the existing typed retrieval contract, not a second memory system.

Fidelity: `production_slice`.

## 3. Scope

- Extend Cortex's existing `MemorySearchFilters` with bounded `subjects` and `topics` dimensions.
- Normalize `subject` and `topic` metadata through the canonical memory-governance path.
- Compile those filters into Chroma pre-retrieval predicates and independently recheck them after retrieval.
- Expose the same fields through the existing OpenClaw `memory_search` bridge schema and request payload.
- Preserve existing project, tag, temporal, lifecycle, principal, privacy, and contradiction behavior.
- Add one focused end-to-end smoke gate covering backend filter behavior and native bridge forwarding.
- Stage or apply the reversible release only after the focused smoke passes and the live baseline remains healthy.

## 4. Non-goals

- Do not install MemPalace, import its database, or copy its palace/wing/room/drawer ontology into Cortex.
- Do not replace Chroma, L22, Librarian, Codec, the memory bridge, temporal governance, or canonical project files.
- Do not change embeddings, ranking weights, summarization policy, retention limits, permissions, model routing, or external-write policy.
- Do not claim MemPalace's published benchmark scores for Cortex.
- Do not add a broad test campaign, benchmark campaign, or autonomous migration.
- Do not store new content or reclassify existing records automatically in this slice.

## 5. Active path / repo layout

- Clean implementation worktree: `/root/clawd/worktrees/cortex-mempalace-adaptation-20261030`
- Baseline: active Cortex source commit `1a283c5b4207808aaecb1eaeffc8fc16f429ecc6`
- Backend owner: `public/cortex_server/cortex_server/runtime/memory_governance.py`
- API owner: `public/cortex_server/cortex_server/routers/librarian.py`
- Native bridge owner: `plugins/cortex-memory-bridge/index.ts`
- Evidence root: `/root/clawd/artifacts/cortex-mempalace-adaptation-20261030`
- Shared dirty workspace `/root/clawd` is inspection-only for this task.

## 6. Prior art and existing assets

Prior-art decision: `extend_existing`.

Evidence: `/root/clawd/artifacts/cortex-mempalace-adaptation-20261030/prior-art.json`.

Existing Cortex assets reused:

- governed typed retrieval filters for project, tags, source, identity, lifecycle, and time;
- principal-scoped Chroma predicates plus post-fetch fail-closed rechecks;
- temporal truth, source lineage, supersession, contradiction projection, and canonical project authority;
- native OpenClaw memory bridge with durable lifecycle spooling and encrypted replay;
- recall evaluation and canonical project direct-read paths.

External source used only as design evidence:

- MemPalace README and MIT license from `github.com/MemPalace/mempalace`;
- transferable idea: structured scoping by people/projects/topics and retention hooks;
- not imported: source code, package, data, benchmark claims, or naming metaphor.

## 7. Target architecture

The existing Cortex memory address becomes:

`authenticated principal -> optional project/subject/topic/source/tag/time filters -> Chroma prefilter -> semantic or lexical retrieval -> governed post-filter -> authority/temporal/conflict ranking -> bounded result`.

`subject` is the existing bounded metadata dimension used for a person, owner, agent, or named entity. `topic` is the existing bounded semantic filing dimension. The API exposes plural query filters, while stored metadata stays singular and backward compatible.

No filter is inferred silently in this slice. Callers may use the new dimensions explicitly, and unfiltered behavior remains unchanged.

## 8. Subsystem ownership matrix

| Surface | Owner | Change | Acceptance |
|---|---|---|---|
| Memory governance | `memory_governance.py` | Add bounded subject/topic filter fields, normalization, Chroma compile, post-check | exact matches pass; nonmatches fail |
| Librarian API | `librarian.py` | Add request schema fields | valid bounded arrays accepted; existing requests unchanged |
| Native memory bridge | `index.ts` | Add tool schema fields and pass them unchanged | request body contains subject/topic filters |
| Evidence | project smoke + artifact summary | Record baseline, diff, command, result, truth boundary | one focused gate green |

## 9. Agent strategy

One read-only source-audit subagent may inspect MemPalace. Implementation remains single-owner in this worktree to avoid merge ambiguity. No remote or heavy execution is needed.

## 10. Phases / waves

### Phase A: source and overlap audit

1. Verify upstream README, license, architecture claims, and benchmark framing.
2. Compare against canonical Cortex memory status and code.
3. Run prior-art gate.

Acceptance: verified source notes plus `decision=extend_existing`.

### Phase B: bounded contract extension

1. Extend backend filter dataclass and validation.
2. Extend metadata normalization and pre/post retrieval predicates.
3. Extend Librarian request schema.
4. Extend native bridge schema and forwarding.

Acceptance: diff touches only the canonical retrieval path, bridge contract, and focused smoke evidence.

### Phase C: focused verification and application

1. Run one focused smoke gate against the exact new address dimensions.
2. Inspect the final diff and live baseline health.
3. Apply through the existing guarded release path if activation is safe and reversible; otherwise stage a pinned activation packet and report the exact blocker.

Acceptance: smoke green and either live readback green or an explicit activation blocker. No completion claim from source-only work.

## 11. Verifier and evidence contract

The single focused smoke must prove:

- `subjects=["Jake"]` selects a matching row and rejects another subject;
- `topics=["memory-architecture"]` selects a matching row and rejects another topic;
- combined subject+topic is AND-scoped;
- the bridge sends both arrays under `filters` without mutation;
- an unfiltered request remains accepted.

The smoke proves mechanical operation only. It does not prove improved real-world recall, broad regression freedom, benchmark parity, or all-memory correctness.

## 12. Artifacts and replay commands

- Prior art: `artifacts/cortex-mempalace-adaptation-20261030/prior-art.json`
- Source audit: `artifacts/cortex-mempalace-adaptation-20261030/source-audit.md`
- Smoke result: `artifacts/cortex-mempalace-adaptation-20261030/smoke-result.txt`
- Diff summary: `artifacts/cortex-mempalace-adaptation-20261030/diff-summary.txt`

Replay command will be recorded verbatim after the smoke harness is finalized.

## 13. Stop condition

`focused_smoke_green_and_guarded_application_readback_green_or_activation_blocker_report`.

## 14. Truth boundary

A green result means Cortex accepts and enforces two additional governed retrieval dimensions in the touched path. It does not mean Cortex is globally better on LongMemEval, that every caller uses the filters, that all existing memories are perfectly tagged, or that MemPalace has been integrated.

## 15. Risks and mitigations

- **Filter mismatch hides valid memory:** opt-in only; unfiltered behavior is unchanged.
- **Chroma and post-filter semantics diverge:** use the same canonical field names and verify both layers.
- **Principal/privacy regression:** preserve principal predicates and combine new clauses through the existing compiler.
- **Metadata bloat or unsafe values:** reuse bounded safe-token validation and existing metadata byte limits.
- **Dirty workspace collision:** implement only in the isolated worktree.
- **Overclaim from upstream benchmarks:** cite upstream scores only as upstream-reported, never as Cortex evidence.
- **Gateway activation risk:** do not restart or mutate the gateway unless the existing guarded activation path proves safe and current.

## 16. Immediate next milestone

Implement the subject/topic filter extension in the isolated worktree, then run the one focused smoke gate.
