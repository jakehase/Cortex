"""L37 Awareness adapter: read-only, evidence-backed system self-report.

Reads the in-memory working memory (if the awareness service is running) and
measured level availability. It never triggers loop actions, model calls,
broadcasts or persistence writes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping

LEVEL = 37
NAME = "awareness"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules.kernel import kernel_level_status
    from cortex_server.routers import awareness

    levels = kernel_level_status(context.get("app") if isinstance(context, Mapping) else None)
    degraded_levels: List[int] = list(levels.get("degraded_levels") or []) if levels.get("measured") else []
    unavailable_levels: List[int] = list(levels.get("unavailable_levels") or []) if levels.get("measured") else []

    wm = awareness._memory  # never constructed here: the adapter must not load/write state
    open_problems: List[Dict[str, Any]] = []
    focus = None
    persistence = None
    accuracy = None
    accuracy_n = 0
    degraded_capabilities: List[str] = []
    if wm is not None and hasattr(wm, "get_active_uncertainties"):
        for item in wm.get_active_uncertainties()[:5]:
            open_problems.append(
                {
                    "source": item.get("source_level"),
                    "summary": str(item.get("description") or "")[:160],
                    "registered_at": item.get("registered_at"),
                    "investigation": str(item.get("investigation_result") or "")[:160] or None,
                }
            )
        focus_row = wm.get_focus()
        if isinstance(focus_row, dict):
            focus = str(focus_row.get("description") or "")[:200] or None
        persistence = (wm.persistence_health() or {}).get("status")
        accuracy = wm.get_prediction_accuracy()
        state = wm.get_state()
        meta = state.get("meta", {}) or {}
        accuracy_n = int(meta.get("predictions_correct", 0) or 0) + int(meta.get("predictions_wrong", 0) or 0)
        degraded_capabilities = list((state.get("self_model") or {}).get("degraded_capabilities") or [])[:10]

    loop_running = bool(getattr(awareness, "_loop_running", False))
    parts = [
        f"Awareness loop {'running' if loop_running else 'not running'}.",
        f"Measured degraded levels: {degraded_levels or 'none'}; unavailable levels: {unavailable_levels or 'none'}."
        if levels.get("measured")
        else "Level availability could not be measured.",
    ]
    if degraded_capabilities:
        parts.append(f"Self-model degraded capabilities: {', '.join(degraded_capabilities)}.")
    if open_problems:
        parts.append(
            "Open problems: "
            + "; ".join(f"{p['source'] or 'unknown'}: {p['summary']}" for p in open_problems)
            + "."
        )
    if focus:
        parts.append(f"Current focus: {focus}.")
    if accuracy is not None:
        parts.append(f"Prediction accuracy {round(accuracy * 100)}% over {accuracy_n} criterion-resolved predictions.")
    return {
        "operation": "awareness.self_report",
        "origin": "deterministic",
        "summary": " ".join(parts)[:1500],
        "data": {
            "loop_running": loop_running,
            "degraded_levels": degraded_levels,
            "unavailable_levels": unavailable_levels,
            "self_model_degraded": degraded_capabilities,
            "open_problems": open_problems,
            "focus": focus,
            "persistence": persistence,
            "prediction_accuracy": accuracy,
            "accuracy_basis_n": accuracy_n,
        },
    }
