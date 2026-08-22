# Level implementation matrix

This matrix is a public-safe map of where novelty is currently represented in the public repo.
It distinguishes between:
- **implemented + publicly documented**
- **implemented but only partially mirrored publicly**
- **private/operational or publishability-limited**

| Area | Levels / surface | Public state | Notes |
|---|---|---:|---|
| Browser / discovery | L2 | Implemented + publicly documented | See `L2_ARCHITECTURE.md` |
| Memory / retrieval | L7 / L22 | Implemented + publicly documented | See `EPISTEMIC_MEMORY.md`, memory bridge docs |
| Architecture / complexity routing | L9 | Publicly documented, implementation only partially mirrored | See `AUTO_LEVEL_ACTIVATION_20260219.md`, `CROSS_LEVEL_ORCHESTRATION_PATTERNS.md` |
| Creativity governor | L13 / L29 / L32 / L34 | Implemented + publicly documented | See `CREATIVITY_GOVERNOR_IMPLEMENTATION.md`, `CORTEX_CREATIVITY_GOVERNOR.md` |
| Council / deliberation | L15 | Publicly documented, implementation only partially mirrored | Covered in novelty and orchestration docs |
| Nexus orchestration | L24 | Implemented + publicly documented | See orchestration, guard, and automation docs |
| Validation stage | L34 | Implemented + publicly documented | See `VALIDATION_AND_SYNTHESIS_ARCHITECTURE.md` |
| Capability reality-checking | cross-level / Nexus | Implemented + publicly documented | See `CORTEX_CAPABILITY_GUARD_CONTROL_PLANE.md` |
| Epistemic guard | cross-level / Nexus | Implemented + publicly documented | See `CORTEX_EPISTEMIC_GUARD_V1.md` |
| Auto-level activation | multi-level | Implemented + publicly documented | See `AUTO_LEVEL_ACTIVATION_20260219.md` |
| Routing autotune / repair | multi-level | Implemented + publicly documented | See `CORTEX_SMARTNESS_AUTOMATION_20260219.md` |
| Oracle prompt pre-routing | Oracle + Nexus | Implemented + publicly documented | See `CORTEX_PROMPT_ROUTING_GUARD_2026-03-15.md` |
| Level registry | all levels | Public-safe reference doc | See `LEVEL_REGISTRY.md` |
| Route-gate plugin code | OpenClaw plugin surface | Partially mirrored publicly | Public docs exist; live implementation primarily remains in workspace/private backup |

## Reading the matrix

"Implemented + publicly documented" means the public repo now contains either:
- direct public-safe implementation docs
- or enough architecture/test evidence to show the feature is real

"Partially mirrored publicly" means the public repo explains the feature, but the full live code path remains in the operational workspace/private backup.

## Why this exists

Without a matrix like this, the repo can look either:
- over-abstracted, or
- falsely complete

This page is meant to keep the public story honest.
