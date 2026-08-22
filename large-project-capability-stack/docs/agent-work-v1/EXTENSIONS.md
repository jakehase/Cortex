# Extending Agent Work v1

Extend Agent Work through contracts and facade composition, not by creating another runner API.

## Safe extension points

- **Objective adapters:** normalize a new intake shape into the canonical contract.
- **Inventory/decomposition:** add deterministic surface discovery while preserving negative-space evidence.
- **Workers:** register a worker capability behind the execution package and existing lease/patch protocol.
- **Verifiers:** add an independent evidence reducer with a versioned schema and fail-closed semantics.
- **Policies:** add typed configuration with CLI > run config > workspace default precedence.
- **Reports:** add a derived projection without changing the underlying terminal-truth authority.

## Required checks

Every extension must declare its schema version, authority owner, execution boundary, artifact paths, failure behavior, and exact claim boundary. Add focused tests and a matrix row. A worker cannot verify its own work. A report cannot promote a red verifier or incomplete matrix.

## Forbidden patterns

Do not expose benchmark controller filenames as product commands; invoke provider CLIs directly from product scripts; create a parallel completion authority; use file existence as completion proof; or silently fall back from remote execution to local heavy work.

## Compatibility

If an interface must move, retain a narrow wrapper with a warning, document migration and rollback, and prove both the new path and bounded fallback. Compatibility code is temporary authority-free routing, not a reason to preserve duplicate architecture indefinitely.
