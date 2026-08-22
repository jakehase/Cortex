# Recommendation Guard (Anti-Duplication)

Purpose: prevent suggesting work that is already implemented.

## Why it exists

A prior recommendation pass repeated items that were already delivered in Dependability Phases 0-2.
The guard enforces a capability reality-check before proposing "what next" work.

## Tool

- Script: `tools/recommendation_guard.py`
- Inputs: inventory docs + proposed items
- Output labels:
  - `already_implemented`
  - `partially_implemented`
  - `missing`

## Standard command

```bash
python3 tools/recommendation_guard.py \
  --inventory-doc docs/DEPENDABILITY_PHASE0.md \
  --inventory-doc docs/DEPENDABILITY_PHASE1.md \
  --inventory-doc docs/DEPENDABILITY_PHASE2.md \
  --proposal "..." --proposal "..."
```

## Operator rule

- Never present `already_implemented` items as new work.
- Present output in three sections: Already in place / Partial / Net-new.
- Include evidence path+line for each classified item.
