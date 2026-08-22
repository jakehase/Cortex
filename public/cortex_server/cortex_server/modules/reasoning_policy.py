from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from cortex_server.modules.governance_compiler import compile_workflow_policy


def build_workflow_policy(
    *,
    name: str,
    goal: str = "",
    description: str = "",
    steps: List[Dict[str, Any]] | None = None,
    metadata: Dict[str, Any] | None = None,
    belief_scope: Optional[Mapping[str, object]] = None,
) -> Dict[str, Any]:
    return compile_workflow_policy(
        name=name,
        goal=goal,
        description=description,
        steps=steps,
        metadata=metadata,
        belief_scope=belief_scope,
    )


__all__ = ["build_workflow_policy"]
