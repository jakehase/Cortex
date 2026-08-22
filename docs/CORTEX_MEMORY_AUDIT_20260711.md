# Full Cortex/OpenClaw memory audit and permanent repair

Date: 2026-07-11 CDT

## Grounding contract

- Reply anchor: the finding that memory files existed but retrieval/decision-making did not reliably respect them; stale semantic claims competed with corrections; Codec health showed an empty synthetic session despite durable activity.
- Fidelity: `production_slice`.
- Scope: semantic Librarian/Chroma, durable/canonical files, structured L22, Codec continuity, OpenClaw bridge, runtime offloaded notes, structural code graph, legacy stores/facades, migration, health, retrieval, and adversarial acceptance checks.
- Stop condition: `completed_and_delivered`.
- Target: `/root/clawd/public/cortex_server`, `/root/clawd/plugins/cortex-memory-bridge`, `/root/clawd/memory`.
- Implementation surface: mixed product code, bridge/control-plane code, migration, tests, canonical durable memory, and evidence artifacts.

## Audit inventory

| Layer | Observed baseline / disposition |
|---|---|
| Semantic Librarian (Chroma) | Live at `/app/cortex_server/chroma_db`; 455 records. Storage/search worked, but lifecycle and canonical authority were absent. |
| Durable file memory | 157 files and 30 project files before this audit's new canonical project file. Canonical facts existed but were only procedural authority. |
| Canonical registry | `memory/projects/INDEX.md`; mapped direct reads were not enforced by the search engine. |
| Structured L22 SQLite | `/app/cortex_server/chroma_db/l22_structured.sqlite3`; durable Codec rows existed. |
| Codec | The old health probe inspected only key `memory_health_gate`, producing false-looking `availableForSession=false`, 0 snapshots, 0 events. Global L22 rows proved continuity existed. |
| OpenClaw bridge | `cortex-memory-bridge` owns the memory slot. Candidate reconciliation had heuristic correction handling, but no durable lifecycle/authority contract and no guaranteed Codec event write. |
| OpenClaw builtin SQLite | `/root/.openclaw/memory/main.sqlite`: 0 files / 0 chunks. This is a non-authoritative shadow while the Cortex plugin owns the slot, not a storage outage. |
| Runtime offloaded memory | 628 files under `/opt/clawdbot/state/runtime_delivery/memory`; explicitly non-authoritative notes. |
| Structural code graph | `/root/clawd/public/cortex_server/cortex_graph.db`: 13,883 nodes / 51,153 edges; parser smoke green. This is code memory, not conversational fact memory. |
| Legacy L7/L22 modules | L7 wrote an orphan JSONL path; L22 Mnemosyne reported placeholder. Neither represented the canonical active stores. |
| Legacy paths | `/app/cortex_server/knowledge/auto_memory.jsonl`, fallback JSONL, and `/root/cortex_server/chroma_db` were absent. |

## Root causes

1. Storage health was incorrectly treated as end-to-end memory health.
2. Canonical file precedence was written policy, not an engine-enforced retrieval contract.
3. Supersession was a heuristic score penalty; stale records had no durable lifecycle state.
4. Codec health conflated one empty synthetic probe key with global continuity.
5. The bridge and server ranked candidates independently without one authority/lifecycle vocabulary.
6. Legacy facade status and paths created misleading parallel-store semantics.
7. Project alias/version matching was too weak for PMHNP Tier 2 and SLOS v19 acceptance queries.

## Permanent changes

- Added `cortex.memory.governance.v1`: `memory_status`, `authority_rank`, `recorded_at`, optional `fact_key`, `superseded_by`, reason, timestamp.
- Added metadata-only `/librarian/supersede`; current queries exclude superseded/tombstoned rows, historical queries retain them.
- New writes sharing a `fact_key` automatically supersede prior versions.
- Added direct reads from the canonical registry and section-aware ranking for Current, Corrections, Already proven, Next, explicit version identifiers, and project aliases.
- Canonical file rows carry authority 90 and cannot be outranked by semantic history for mapped current-state queries.
- Migrated all 455 existing semantic rows; one known contradicted PMHNP claim was explicitly superseded.
- Added the PMHNP Tier 2 correction to its actual canonical benchmark file and expanded the registry alias.
- Bridge reconciliation now consumes authority/lifecycle metadata and excludes superseded rows from current queries.
- Bridge writes safe agent-end events to `/nexus/codec/events` for durable session continuity.
- Codec health now scans the global durable L22 ledger and separately exposes the isolated probe key.
- Expanded `/knowledge/memory-health` to report governance, L22 structured state, bridge ownership/shadow index, runtime notes, legacy paths, graph, and parser/index checks.
- Replaced orphan/placeholder L7/L22 module behavior with canonical-store facades.
- Made the graph's default database path absolute.

## Migration result

Artifact: `memory-governance-migration-20260711.json`

- Applied: true
- Total: 455
- Active: 454
- Superseded: 1
- Known superseded id: `50b44251-b2c8-4179-8a71-7046c25cfefb`
- Replacement/correction id: `72ea1c3d-a581-436d-b0ac-f07fad566400`

## Verification

- Full Cortex suite: 523/523 passed after final packaging.
- Focused Librarian + Codec + Nexus + L22 suite: 69/69 passed after initial repair; subsequent focused gates rerun after ranking/health refinements.
- OpenClaw bridge: 10/10 passed.
- Diff whitespace gate: passed for touched files.
- Live service restarted and `/ready` passed.
- Live health: all components `ok=true`.
- Live Codec checkpoint during validation: continuity ready; 37 global snapshots, 55 source events (monotonically growing).
- Current PMHNP query excludes known superseded record; explicit historical query retrieves it.
- Agent Work “what next?” returns canonical Already proven/Next and the `semantic_auto` delta.
- Agent Work six-hour dogfood query returns canonical already-proven truth.
- PMHNP Tier 2 query returns verification-only correction.
- SLOS v19 query resolves the adapter/prior-art correction rather than treating initial duplicated work as current truth.

## Boundaries / residual operational risk

- No finite migration can infer every contradiction in free-form historical text. Canonical authority now prevents old semantic history from controlling mapped current-state answers; future keyed revisions supersede automatically, and explicit correction records can tombstone discovered legacy rows without deletion.
- Runtime notes remain non-authoritative by design.
- The structural graph index should be refreshed after material source changes; its current database and parser are healthy.
- External user-visible actions were not part of this repair.
