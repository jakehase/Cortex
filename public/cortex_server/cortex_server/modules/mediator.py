"""Level 31: Mediator - legacy module surface.

The real implementation is ``cortex_server.routers.mediator`` (model-backed,
principal-scoped, strict schema). This class used to return fixed strings such
as "[L31 Mediator] Mediating between N parties on: ..." that looked like
results. It now delegates to the router core, or raises when it cannot.
"""

from __future__ import annotations

from typing import Any, Dict, List


class Mediator:
    def __init__(self):
        self.name = "mediator"
        self.level = 31
        self.description = "Conflict resolution and negotiation"

    async def mediate(self, parties: List[str], issue: str, *, principal_scope_key: str) -> Dict[str, Any]:
        """Mediate between two parties' positions on ``issue`` via the router core."""

        if not isinstance(parties, (list, tuple)) or len(parties) != 2:
            raise ValueError("Mediator.mediate requires exactly two party positions")
        from cortex_server.routers.mediator import mediate_core

        result = await mediate_core(
            str(parties[0]), str(parties[1]), str(issue or "") or None,
            principal_scope_key=principal_scope_key,
        )
        return result.model_dump()

    async def negotiate_terms(self, proposal: str, *, principal_scope_key: str) -> Dict[str, Any]:
        """Resolution strategies for a proposal/conflict via the router core."""

        from cortex_server.routers.mediator import resolve_core

        result = await resolve_core(str(proposal or ""), principal_scope_key=principal_scope_key)
        return result.model_dump()
