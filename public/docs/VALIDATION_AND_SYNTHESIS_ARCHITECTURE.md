# Validation and synthesis architecture

## Core idea

Cortex is trying to make validation and synthesis first-class stages.

## Why this matters

Many systems:
- gather evidence
- answer quickly
- hide validation inside the same loop

Cortex is moving toward a clearer separation:
- retrieve or browse
- check/validate
- synthesize only after that

## Architectural roles

### Validation
Validation is an explicit architectural concern, not just a quality hope.

### Synthesis
Synthesis is not just summarization. It is the stage that should integrate:
- retrieved evidence
- routing context
- validation outcome
- uncertainty handling

## Distinctive claim

This makes the system feel more like a layered reasoning stack than a single-shot agent loop.
