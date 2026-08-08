# Author Separation Interfaces

## Treatment author interface

Produce `treatment.bundle.json` containing exactly the 12 declared concept IDs and task-neutral cards. Each card must contain: `conceptId`, `principle`, `assumptions`, `implementationHeuristics`, and `misuseWarnings`. Total retrievable text is at most 1,800 words. Do not include scored task names, APIs, fixtures, seeds, reference code, or more than three consecutive lines of executable code.

## Task author interface

Produce a canary bank and, only after canary acceptance, a full task bank. Each task exposes a CommonJS JavaScript submission contract and has deterministic hidden tests. The author receives only the requested domain/family shape, runtime limits, and generic submission protocol. Do not inspect treatment content or infer expected wording from retrieval keys.

## Integrator interface

Freeze SHA-256 digests of both outputs before combining them. The model-visible prompt contains the same task bytes in both arms; only the candidate arm receives mapped treatment cards in a clearly delimited context block. Hidden metadata and tests never enter either prompt. Any content change after scored output exists invalidates the benchmark version.
