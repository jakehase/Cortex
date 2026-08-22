from __future__ import annotations

from typing import Any, Callable, Dict, List, Sequence, Tuple

from cortex_server.modules.reasoning_contracts import ConstraintDecision, model_dump_compat


JsonDict = Dict[str, Any]
OverlayFn = Callable[[JsonDict, JsonDict], JsonDict]
OverlaySpec = Tuple[str, OverlayFn]


RUNTIME_CONSTRAINT_PRECEDENCE: List[str] = [
    "routing_r9",
    "homeostasis",
    "world_state",
    "modulation",
    "workspace",
    "truth_engine",
    "plasticity",
    "embodiment",
]



def _values_equal(left: Any, right: Any) -> bool:
    return left == right



def apply_overlay_precedence(*, policy: JsonDict, base_settings: JsonDict, overlays: Sequence[OverlaySpec]) -> JsonDict:
    settings = dict(base_settings or {})
    field_owner: Dict[str, str] = {}
    decisions: List[JsonDict] = []

    for name, overlay_fn in overlays:
        before = dict(settings)
        after = dict(overlay_fn(policy, settings) or settings)
        changed_fields = [field for field in after.keys() if not _values_equal(before.get(field), after.get(field))]
        settings = after
        for field in changed_fields:
            previous_owner = field_owner.get(field)
            decisions.append(
                model_dump_compat(
                    ConstraintDecision(
                        decision_id=f"constraint_decision:{name}:{field}:{len(decisions)+1}",
                        field=field,
                        previous_value=before.get(field),
                        chosen_value=after.get(field),
                        decided_by=name,
                        rationale=f"runtime_constraint_precedence:{name}",
                        overridden_signals=[previous_owner] if previous_owner else [],
                        outcome="overridden" if previous_owner else "applied",
                        metadata={"precedence": list(RUNTIME_CONSTRAINT_PRECEDENCE)},
                    )
                )
            )
            field_owner[field] = name

    settings["constraint_precedence"] = list(RUNTIME_CONSTRAINT_PRECEDENCE)
    settings["constraint_decisions"] = decisions
    settings["constraint_field_owners"] = dict(field_owner)
    return settings


__all__ = [
    "RUNTIME_CONSTRAINT_PRECEDENCE",
    "apply_overlay_precedence",
]
