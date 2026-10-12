"""The Council - legacy synchronous facade for Level 15.

Used by ``modules/geneticist.py`` to review evolution proposals. It no longer
has its own model calls (the old version posted unauthenticated requests to
``/oracle/chat`` pinned to ``tinyllama`` and treated any response containing
"YES" as approval). It delegates to the one Council review implementation,
``routers.council.council_review_sync``: deterministic hard gate + strict,
receipt-validated model decision. Approval requires an explicit APPROVE
verdict from a validated model decision; anything else (including the model
being unavailable) is a rejection.
"""
from __future__ import annotations

from typing import Any, Dict, List

_LEGACY_SCOPE_KEY = "admin:level.council.legacy_review"


class TheCouncil:
    """Adversarial review board for evolution proposals (delegating)."""

    def __init__(self):
        self.critique_history: List[Dict[str, Any]] = []

    def review_proposal(self, proposal: Dict) -> bool:
        """Review a skill proposal. Returns True only on a validated model APPROVE."""

        from cortex_server.routers.council import council_review_sync

        proposal = proposal if isinstance(proposal, dict) else {}
        skill_name = str(proposal.get("proposed_module") or "unknown")[:200]
        context = (
            f"Detected from: {str(proposal.get('detected_from') or '')[:1000]}\n"
            f"Gap summary: {str(proposal.get('gap_summary') or '')[:3000]}\n"
            "This skill would be auto-generated and installed into modules/extensions/."
        )
        code = proposal.get("code") or proposal.get("source")
        try:
            decision = council_review_sync(
                kind="evolution_skill_proposal",
                title=f"Skill proposal: {skill_name}",
                context=context,
                code=str(code) if code else None,
                risk_tolerance="low",
                principal_scope_key=_LEGACY_SCOPE_KEY,
            )
        except Exception as exc:
            decision = {"success": False, "verdict": "NEEDS_CHANGES", "error": f"{type(exc).__name__}"}

        approved = bool(
            decision.get("success")
            and decision.get("decision_source") == "model"
            and decision.get("verdict") == "APPROVE"
        )
        self.critique_history.append({
            "skill_name": skill_name,
            "verdict": decision.get("verdict"),
            "decision_source": decision.get("decision_source"),
            "risk_score": decision.get("risk_score"),
            "top_concerns": decision.get("top_concerns") or [],
            "receipt_id": decision.get("receipt_id"),
            "error": decision.get("error"),
            "approved": approved,
        })
        del self.critique_history[:-100]
        return approved

    def get_last_review(self) -> Dict:
        """Get the most recent review record."""
        if self.critique_history:
            return self.critique_history[-1]
        return {}

    def get_review_stats(self) -> Dict:
        """Get statistics on Council decisions (this process)."""
        total = len(self.critique_history)
        approved = sum(1 for r in self.critique_history if r.get("approved"))
        return {
            "total_reviewed": total,
            "approved": approved,
            "rejected": total - approved,
            "approval_rate": approved / total if total > 0 else 0,
        }


# Singleton instance
_council_instance = None


def get_council() -> TheCouncil:
    """Get or create The Council singleton."""
    global _council_instance
    if _council_instance is None:
        _council_instance = TheCouncil()
    return _council_instance
