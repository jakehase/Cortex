# Corrected selective private-utility validation contract

## Reply anchor and correction

Jake identified that the first utility arm was ceiling-limited: no-pack scored 24/27 while pack scored 27/27, leaving only 11.1 percentage points of possible lift against a frozen 20-point gate. On 2026-07-25 he approved a corrected harder test by saying “Do it.”

The completed first run remains an immutable no-go under its own contract. This validation is a new prospective test of a narrower claim; no prior trials or favorable items are appended.

## Claim under test

Does item-matched retrieval materially improve exact answers on selectively routed workspace tasks whose answers depend on low-sensitivity private facts that the base model cannot reliably infer?

This is not a test of broad ordinary-task utility, autonomous learning, model-weight change, durability, or default-path readiness.

## Frozen design

Both fixture files and the full program must be hashed and frozen before any validation model call.

- Calibration pool: 12 independent private facts, two open-ended paraphrases each, 24 fresh no-pack sessions.
- Held-out pool: 30 different private facts, two open-ended paraphrases each, 60 identical-item pack/no-pack pairs, 120 fresh sessions.
- Total cap: 144 model calls.
- Calibration and held-out pools must have disjoint lesson IDs, fact IDs, concept IDs, and rule digests.
- The held-out pool is frozen before calibration outcomes and cannot be modified based on calibration.
- No multiple-choice answers, answer options, tools, conversational carryover, or outcome-driven reruns.
- Exact deterministic grading; answer text is trimmed and compared case-insensitively.
- Statistical unit: one private fact cluster. Both paraphrases must pass for an arm to pass the cluster.
- Runtime: `gpt-5.6-sol`, low reasoning, fresh ephemeral Codex sessions, read-only sandbox.

The two private fixtures stay outside Git and may contain only low-sensitivity operational facts. Credentials, tokens, client-identifying facts, financial identifiers, email addresses, and network addresses are prohibited.

## Calibration headroom gate

Proceed to held-out calls only when all are true:

- at least 90% of calibration items are valid;
- invalid-item rate is no greater than 10%;
- no-pack item accuracy is no greater than 60%;
- no-pack fact-cluster accuracy is no greater than 50%.

Calibration trials contribute no held-out efficacy wins. If this gate fails, stop before all 120 held-out calls.

## Held-out gates

All must pass:

- at least 90% of item pairs and fact clusters are valid;
- invalid-cluster rate is no greater than 10%;
- pack item accuracy is at least 90%;
- pack cluster accuracy is at least 85%;
- pack-minus-no-pack lift is at least 20 percentage points at both item and cluster levels;
- pack-only clusters exceed no-pack-only clusters;
- two-sided exact McNemar p-value over discordant fact clusters is no greater than 0.05;
- no more than one no-pack-only fact cluster;
- mean input-token overhead is no greater than 1,200 tokens;
- maximum retrieval-pack estimate is no greater than 600 tokens;
- median latency overhead is no greater than 10 seconds.

## Decision boundary

A full pass permits only:

`GO — selective private-retrieval shadow candidate`

It does not enable default routing. Any default-path integration requires a separate explicit decision, rollback plan, and live shadow evidence.

Any calibration failure, held-out threshold miss, invalidity excess, regression, cost failure, or blocker remains a no-go for this claim.

## Evidence requirements

Preserve the frozen source commit, source archive hash, both private fixture hashes, frozen program hash, every provider event and usage record, every prompt/answer/grade/retrieval pack, calibration and clustered held-out analyses, campaign/supervisor/notifier states, return-bundle checksum, and complete manifest replay on the control plane.
