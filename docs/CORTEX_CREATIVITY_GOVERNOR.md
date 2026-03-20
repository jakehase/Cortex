# Cortex Creativity Governor

Status: implemented in `/root/clawd/plugins/cortex-route-gate/index.ts`

## Goal

Reduce recency anchoring and context overfitting when the user asks for:
- novel ideas
- original categories
- orthogonal directions
- brainstorming / ideation
- "first to build" style invention
- prompts that explicitly say not to stay inside the current frame

## Trigger signals

The governor activates on prompts that contain creativity/novelty intent such as:
- brainstorm / ideate / come up with ideas
- novel / originality / invent / first to build / from scratch
- orthogonal / unrelated / outside of / different direction
- explicit negative constraints like "not memory" or "not necessarily related"

## What it does

1. **Detects novelty intent**
   - Builds a `CreativityProfile` for the prompt.

2. **Quarantines recent anchors**
   - Loads recent prompt token history from `stateDir/prompt-history.json`.
   - Extracts recent content tokens as likely anchor terms.
   - Promotes those terms into a context quarantine list for novelty prompts.

3. **Honors explicit negative constraints**
   - Pulls terms from phrases like:
     - `not related to X`
     - `outside of X`
     - `other than X`
     - `didn't have to do with X`

4. **Enforces creative routing support**
   - Ensures these levels are present when creativity mode is active:
     - L13 Dreamer
     - L29 Muse
     - L32 Synthesist
     - L34 Validator

5. **Injects a creativity contract into the prompt**
   - `CORTEX_CREATIVITY_GOVERNOR`
   - Requires:
     - three candidate directions before convergence
     - orthogonal/wild-card ideas before adjacent ones when novelty is requested
     - anti-anchor checks
     - Dreamer/Muse/Synthesist operational roles

## Prompt contract

When active, the governor tells the assistant to:
- avoid leading with near-neighbor ideas from the recent thread
- avoid quarantined terms in the first wave of concepts
- regenerate once if the answer looks like a continuation of the previous topic
- treat Dreamer/Muse/Synthesist as operational roles, not decorative labels

## State files

- `adaptive-routing-stats.json`
- `prompt-fingerprints.json`
- `prompt-history.json` ← new, used for anchor detection

## Config

Exposed in `plugins/cortex-route-gate/openclaw.plugin.json`:
- `creativityGovernorEnabled` (default true)
- `creativityHistorySize` (default 24)
- `creativityQuarantineTerms` (default 8)

## Limits

This is a routing/prompt governor, not a magic originality guarantee.
It improves conceptual distance by:
- detecting novelty intent
- downweighting recent anchors
- forcing divergent first-pass structure

But truly novel outputs still depend on the underlying model and prompt quality.

## Practical outcome

The governor is designed to stop the common failure mode:
- user asks for novelty
- assistant gives an adjacent extension of whatever was discussed most recently

Instead, it pushes the system toward:
- broader conceptual distance
- explicit anti-anchor behavior
- structured divergence before convergence
