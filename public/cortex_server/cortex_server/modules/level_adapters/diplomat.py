"""ExecutionEngine adapter for L18 Diplomat: when the user wants to write or
answer a message (or negotiate), draft it with the model for the USER to send.
Never sends anything; delivery stays held and approval-gated."""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters._safe_level_common import (
    blocked_from_status,
    clip,
    require_query,
    require_scope,
)

LEVEL = 18
NAME = "diplomat"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # produces a draft only; no egress, nothing is sent
DEFAULT_DEADLINE_S = 60.0

_OUTBOUND = re.compile(
    r"\b(draft|write|compose|reply|respond|answer|email|e-mail|message|text|dm|letter|note|pitch|follow[- ]?up|"
    r"negotiat\w*|counter[- ]?offer|ask (?:him|her|them)|tell (?:him|her|them))\b",
    re.I,
)
_NEGOTIATION = re.compile(r"\b(negotiat\w*|discount|price|pricing|offer|counter|salary|raise|rate|terms|deal)\b", re.I)
_CHANNEL = (
    ("sms", re.compile(r"\b(sms|text message|text him|text her|text them)\b", re.I)),
    ("chat", re.compile(r"\b(slack|whatsapp|teams|chat|dm)\b", re.I)),
    ("linkedin", re.compile(r"\blinkedin\b", re.I)),
    ("letter", re.compile(r"\bletter\b", re.I)),
    ("email", re.compile(r"\b(email|e-mail|mail)\b", re.I)),
)


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import diplomat as diplomat_router

    text = require_query(query)
    if not _OUTBOUND.search(text):
        raise ExecutionBlocked("no_outbound_message_intent")
    scope = require_scope(context)
    channel = next((name for name, pattern in _CHANNEL if pattern.search(text)), "other")
    convo = context.get("conversation")
    if isinstance(convo, (list, tuple)):
        convo = "\n".join(str(x) for x in convo[-8:])
    request = diplomat_router.DraftRequest(
        goal=text[:2000],
        channel=channel,
        thread=(str(convo)[-8000:] if convo else None),
        negotiation=bool(_NEGOTIATION.search(text)),
    )
    out = await diplomat_router.create_draft(request, principal_scope_key=scope)
    if not out.get("success"):
        raise blocked_from_status(out.get("status"))
    draft = out["draft"]
    position = draft.get("negotiation_position")
    summary = (
        f"Diplomat draft ({channel}, tone {draft.get('tone')}) for the user to send themselves — NOT sent. "
        + (f"Subject: {draft.get('subject')}. " if draft.get("subject") else "")
        + f"Draft: {clip(draft.get('draft_message'), 900)}"
        + (f" Position: anchor {position['anchor']}, walk-away {position['walk_away']}." if position else "")
        + (f" Risks: {'; '.join(clip(r, 100) for r in (draft.get('risks') or [])[:3])}." if draft.get("risks") else "")
    )
    return {
        "operation": "diplomat.draft",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "channel": channel,
            "subject": draft.get("subject"),
            "draft_message": clip(draft.get("draft_message"), 2000),
            "negotiation_position": position,
            "risks": [clip(r, 160) for r in (draft.get("risks") or [])[:3]],
            "requires_user_to_send": True,
            "sent": False,
        },
        "model": out.get("model"),
        "receipt_id": out.get("receipt_id"),
        "elapsed_ms": out.get("elapsed_ms"),
    }
