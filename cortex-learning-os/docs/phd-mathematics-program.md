# PhD mathematics trajectory and claim boundary

## Scope

The machine-readable program consists of:

- `capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json`: a static 264-concept prerequisite DAG;
- `capsules/math-foundations/phd-competency-rubric.v1.json`: six stages, 19 tracks, one mapping for every concept, formal-proof obligations, and the `phd_math_qualified` gate;
- `capsules/math-foundations/phd-qualifying-blueprint.v1.json`: four unseen core qualifying exams plus specialization, formal-proof, and research gates;
- the corresponding strict schemas in `schemas/`; and
- `src/phd-competency.mjs`: pure validation and capability-report computation.

The first 84 concept objects in the trajectory are canonically identical to, and in the same order as, `curriculum.continuous-acquisition-v1.graph.json`. The 180 additions cover proof foundations; linear algebra; real, complex, functional, and harmonic analysis; abstract and commutative algebra; topology and algebraic topology; differential geometry; differential equations and dynamical systems; measure-theoretic probability and stochastic processes; statistics; combinatorics and graph theory; number theory; logic and set theory; numerical analysis and optimization; and mathematical research practice.

## Stages and evidence

The stages are ordered:

1. `proof_foundations`
2. `undergraduate_core`
3. `graduate_core`
4. `qualifying`
5. `specialization`
6. `research`

Concept acquisition records curriculum coverage only. The qualification claim additionally requires:

- coverage of every concept marked required in proof foundations, undergraduate core, and graduate core;
- passing all four declared-unseen core qualifying exams under the sealed-prompt and independent-proctor protocol;
- kernel-checked evidence for every required formal-proof obligation;
- one passing declared-unseen specialization exam; and
- one bounded research artifact that passes independent review, independent reproduction, frozen-corpus/environment checks, and an artifact-bound formal proof of its main result.

All evidence is subject-bound, version-bound, age-bounded, and bound to canonical SHA-256 digests of the graph, rubric, blueprint, exam specifications, and proof obligations. Missing, duplicate, stale, malformed, unknown, or digest-mismatched evidence makes the report fail closed.

Qualifying exams are qualification events, not spaced review. A course-completion record, acquisition frontier, or qualifying score cannot substitute for the other gates.

## Novelty and truth boundaries

Research novelty is reported separately as exactly one of:

- `unestablished`;
- `bounded_corpus_only`; or
- `externally_established`.

`bounded_corpus_only` means only that the frozen search found no match in that corpus. Even `externally_established` records external evidence rather than allowing this module to infer global novelty. The capability report always keeps `globalNoveltyInferred` false.

Writing, loading, or covering this curriculum does not create mathematical capability, confer a degree, alter model weights, demonstrate durable retention, or establish unrestricted research ability. A true `phd_math_qualified` value means only that all declared machine gates passed for the exact evidence bundle and artifact versions reported.
