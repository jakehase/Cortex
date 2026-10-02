"""Shared verification for response-bound Oracle completion evidence."""

from __future__ import annotations

from datetime import datetime
import hashlib
from typing import Any, Mapping


ORACLE_COMPLETION_VERSION = "cortex.oracle.completion.v1"
ORACLE_COMPLETION_KINDS = frozenset({"provider_response", "local_execution", "upstream_execution"})


def verified_completion_text(payload: Any) -> str:
    """Return completed text only when the upstream receipt binds that text."""
    if not isinstance(payload, Mapping) or payload.get("done") is not True:
        return ""
    response = str(payload.get("response") or payload.get("text") or "")
    receipt = payload.get("completion_receipt")
    if not response.strip() or not isinstance(receipt, Mapping):
        return ""
    if str(receipt.get("version") or "") != ORACLE_COMPLETION_VERSION:
        return ""
    if str(receipt.get("kind") or "") not in ORACLE_COMPLETION_KINDS:
        return ""
    if not str(receipt.get("receipt_id") or "").strip() or not str(receipt.get("source") or "").strip():
        return ""
    try:
        completed_at = datetime.fromisoformat(str(receipt.get("completed_at") or ""))
    except (TypeError, ValueError):
        return ""
    if completed_at.tzinfo is None:
        return ""
    response_sha256 = hashlib.sha256(response.encode("utf-8")).hexdigest()
    if response_sha256 not in {
        str(receipt.get("response_sha256") or ""),
        str(receipt.get("delivered_response_sha256") or ""),
    }:
        return ""
    return response


__all__ = ["verified_completion_text"]
