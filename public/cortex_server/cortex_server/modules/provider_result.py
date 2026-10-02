"""Truthful provenance fields shared by provider-backed reasoning routes."""

from datetime import datetime
import hashlib
import hmac
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ProviderResultOrigin = Literal[
    "provider",
    "schema_repair",
    "deterministic_fallback",
    "heuristic",
]


class ProviderResultEnvelope(BaseModel):
    """Describe how a result was produced, separately from its usability."""

    # Defaults are deliberately fail-closed. Provider success must be set by a
    # call site only after it validates provider/model evidence.
    origin: ProviderResultOrigin = "deterministic_fallback"
    provider_invoked: bool = False
    provider: Optional[str] = None
    model: Optional[str] = None
    degraded: bool = True
    repair_applied: bool = False
    cache_status: Literal["not_used", "hit", "miss"] = "not_used"
    validated_evidence: List[str] = Field(default_factory=list)


class ValidatedProviderText(str):
    """String-compatible text carrying response-bound provider identity."""

    def __new__(
        cls,
        value: str,
        *,
        provider: str,
        model: str,
        origin: str,
        completion_receipt: Dict[str, Any],
    ):
        obj = super().__new__(cls, value)
        obj.provider = provider
        obj.model = model
        obj.origin = origin
        obj.provider_invoked = True
        obj.completion_receipt = dict(completion_receipt)
        return obj


def validated_oracle_provider_text(payload: Any) -> ValidatedProviderText:
    """Validate Oracle's provider completion envelope and return its text.

    A non-empty ``response`` alone is not evidence: deterministic/emergency
    Oracle lanes also return text. The receipt must bind the delivered bytes to
    the actual provider and model before a deliberative route may claim model
    work.
    """

    if not isinstance(payload, dict):
        raise ValueError("oracle_completion_envelope_invalid")
    response = payload.get("response", payload.get("text"))
    model = str(payload.get("model") or "").strip()
    lane = str(payload.get("lane") or "").strip()
    origin = str(payload.get("origin") or "").strip()
    receipt = payload.get("completion_receipt")
    if (
        not isinstance(response, str)
        or not response.strip()
        or payload.get("done") is not True
        or payload.get("provider_invoked") is not True
        or payload.get("degraded") is not False
        or not model
        or not lane
        or not origin
        or not isinstance(receipt, dict)
    ):
        raise ValueError("oracle_provider_completion_unverified")
    disallowed = ("emergency", "synthetic", "deterministic", "receiptless", "test_hook", "forced_empty")
    if any(marker in lane.casefold() or marker in origin.casefold() for marker in disallowed):
        raise ValueError("oracle_provider_provenance_rejected")

    evidence = receipt.get("evidence")
    provider = str(evidence.get("provider") or "").strip() if isinstance(evidence, dict) else ""
    receipt_model = str(evidence.get("model") or "").strip() if isinstance(evidence, dict) else ""
    identity_source = str(evidence.get("identity_source") or "").strip() if isinstance(evidence, dict) else ""
    if (
        receipt.get("version") != "cortex.oracle.completion.v1"
        or receipt.get("kind") != "provider_response"
        or not str(receipt.get("receipt_id") or "").strip()
        or not provider
        or not receipt_model
        or not identity_source
        or not hmac.compare_digest(receipt_model.casefold(), model.casefold())
        or not hmac.compare_digest(
            str(receipt.get("source") or "").casefold(),
            f"{provider}:{receipt_model}".casefold(),
        )
    ):
        raise ValueError("oracle_provider_identity_unverified")

    completed_at = str(receipt.get("completed_at") or "").strip()
    try:
        if datetime.fromisoformat(completed_at).tzinfo is None:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise ValueError("oracle_completion_timestamp_invalid") from exc

    response_sha256 = hashlib.sha256(response.encode("utf-8")).hexdigest()
    if response_sha256 not in {
        str(receipt.get("response_sha256") or ""),
        str(receipt.get("delivered_response_sha256") or ""),
    }:
        raise ValueError("oracle_completion_response_unbound")

    return ValidatedProviderText(
        response,
        provider=provider,
        model=model,
        origin=origin,
        completion_receipt=receipt,
    )


def provider_text_fields(
    text: str,
    *,
    origin: ProviderResultOrigin,
    degraded: bool = False,
    repair_applied: bool = False,
    validated_evidence: Optional[List[str]] = None,
) -> dict:
    """Build envelope fields only from receipt-validated provider text."""

    provider = str(getattr(text, "provider", "") or "").strip()
    model = str(getattr(text, "model", "") or "").strip()
    backend_origin = str(getattr(text, "origin", "") or "").strip()
    receipt = getattr(text, "completion_receipt", None)
    # Revalidate at the response construction boundary so a plain string or a
    # hand-attached provider label cannot create provider provenance.
    validated = validated_oracle_provider_text(
        {
            "response": str(text),
            "model": model,
            "done": True,
            "lane": "deliberative_provider",
            "origin": backend_origin,
            "provider_invoked": True,
            "degraded": False,
            "completion_receipt": receipt,
        }
    )

    return provider_result_fields(
        origin=origin,
        provider_invoked=True,
        # Use the identity returned by receipt validation, not mutable
        # attributes attached to the string-like carrier.
        provider=validated.provider,
        model=validated.model,
        degraded=degraded,
        repair_applied=repair_applied,
        validated_evidence=validated_evidence,
    )


def provider_result_fields(
    *,
    origin: ProviderResultOrigin,
    provider_invoked: bool,
    provider: Optional[str] = "oracle",
    model: Optional[str] = None,
    degraded: bool = False,
    repair_applied: bool = False,
    cache_status: Literal["not_used", "hit", "miss"] = "not_used",
    validated_evidence: Optional[List[str]] = None,
) -> dict:
    """Return the JSON form for routes that do not use a response model."""

    return ProviderResultEnvelope(
        origin=origin,
        provider_invoked=provider_invoked,
        provider=provider if provider_invoked else None,
        model=model,
        degraded=degraded,
        repair_applied=repair_applied,
        cache_status=cache_status,
        validated_evidence=list(validated_evidence or []),
    ).model_dump()
