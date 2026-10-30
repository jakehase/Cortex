# Cortex structural memory addressing decisions

## 2026-10-30, extend Cortex instead of installing MemPalace

Decision: `extend_existing`.

Reason: Cortex already has the critical durable-memory architecture, including principal isolation, source lineage, temporal validity, supersession, contradiction handling, canonical project authority, lifecycle replay, and typed pre-retrieval filters. Installing MemPalace would create a parallel authority and duplicate Chroma-backed storage.

Evidence: `/root/clawd/artifacts/cortex-mempalace-adaptation-20261030/prior-art.json` and the active source at commit `1a283c5b4207808aaecb1eaeffc8fc16f429ecc6`.

## 2026-10-30, borrow structural scoping without the palace metaphor

Decision: add subject/person and topic dimensions to Cortex's existing governed filters.

Reason: MemPalace's strongest transferable design idea is structured narrowing by people, projects, and topics. Cortex already supports projects and tags but does not expose its existing `subject` and `topic` metadata as first-class retrieval filters.

Supersession: none.

## 2026-10-30, retain Cortex's verbatim and lifecycle owners

Decision: do not add a second autosave or verbatim store.

Reason: the OpenClaw memory bridge already has bounded encrypted lifecycle spooling, idempotent identities, replay, and source hashes, while Librarian/L22 already preserve governed records and lineage. The new slice must not fork those paths.

## 2026-10-30, use one focused smoke gate

Decision: verify only the newly touched backend and bridge contract in one bounded smoke command.

Reason: this follows Jake's standing implementation workflow and avoids turning a small retrieval extension into a broad qualification campaign. A green smoke proves mechanical operation only.
