# Creativity governor implementation

## Core idea

Creativity is not treated as a vague style preference.
It is handled as an explicit routing/governor problem.

## Path

The creativity path explicitly emphasizes:
- Dreamer
- Muse
- Synthesist
- Validator

## Why that is interesting

Instead of saying “be creative,” the architecture tries to separate:
- divergence
- reframing
- selection/synthesis
- validation

## Additional guardrails

The implementation direction includes:
- anti-anchor checks
- conceptual distance constraints
- retry pressure when outputs are too adjacent
- explicit governor contracts

## Distinctive claim

The novelty is that creativity is treated as something architected and constrained, not just requested rhetorically.
