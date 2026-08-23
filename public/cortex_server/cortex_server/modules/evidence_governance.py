from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import uuid4

from cortex_server.models.evidence import CapabilityLayer, RuntimeEvent
from cortex_server.modules.sensitive_data_redaction import redact_sensitive_data_with_metadata


JsonDict = Dict[str, Any]
EVENT_SCHEMA_VERSION = "cortex.runtime.event.v1"
LINEAGE_SCHEMA_VERSION = "cortex.traceability.v1"
STATE_CLASSES = ("raw_evidence", "inferred_state", "learned_preference", "operator_override")
PROCESS_EVENT_FAMILIES = {
    "command_started": "execution",
    "command_finished": "execution",
    "command_stdout": "output",
    "command_stderr": "output",
    "tool_call_started": "tooling",
    "tool_call_finished": "tooling",
    "tool_call_stdout": "output",
    "tool_call_stderr": "output",
    "file_written": "artifact",
    "file_deleted": "artifact",
    "git_status_snapshot": "git",
    "git_diff_snapshot": "git",
    "git_diff_cached_snapshot": "git",
    "node_running": "process",
    "node_completed": "process",
    "node_failed": "process",
    "node_retry_scheduled": "process",
    "process_paused": "process",
    "process_resumed": "process",
    "process_cancelled": "process",
    "process_wake": "process",
    "process_progress_synced": "process",
}


REDaction_LEVELS = ("public_safe", "operator_safe", "sensitive_local", "credential_like", "secret_never_display")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _mode_env(name: str, default: str) -> str:
    raw = os.getenv(name)
    return (raw.strip().lower() if raw is not None else default).strip() or default


def redact_payload(value: Any, *, mode: str = "operator_safe") -> Tuple[Any, JsonDict]:
    redacted, meta = redact_sensitive_data_with_metadata(
        value,
        max_string_chars=260 if mode == "public_safe" else None,
    )
    meta = {"mode": mode, **meta}
    meta["redacted_fields"] = list(meta.get("redacted_fields") or [])[:50]
    return redacted, meta


def classify_event_family(kind: str) -> str:
    return PROCESS_EVENT_FAMILIES.get(str(kind or "").strip(), "runtime")


def _default_visibility_for_kind(kind: str) -> str:
    family = classify_event_family(kind)
    if family in {"output", "artifact", "git", "tooling", "execution"}:
        return "operator_safe"
    return "public_safe"


def _first_non_empty(*values: Any) -> Optional[str]:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return None


def _coerce_parent_ids(*values: Any) -> List[str]:
    out: List[str] = []
    for value in values:
        if isinstance(value, (list, tuple)):
            candidates = value
        elif value is None:
            continue
        else:
            candidates = [value]
        for item in candidates:
            text = str(item or "").strip()
            if text and text not in out:
                out.append(text)
    return out


def normalize_runtime_event(
    event: Optional[JsonDict] = None,
    *,
    process_id: Optional[str] = None,
    kind: Optional[str] = None,
    payload: Optional[JsonDict] = None,
    ts: Optional[str] = None,
    event_id: Optional[str] = None,
) -> JsonDict:
    raw = dict(event or {})
    payload_value = dict(payload or raw.get("payload") or {})
    process_value = _first_non_empty(process_id, raw.get("process_id"), raw.get("processId"), payload_value.get("process_id"), payload_value.get("processId")) or ""
    kind_value = str(kind or raw.get("event_kind") or raw.get("kind") or "runtime_event").strip() or "runtime_event"
    requested_visibility = str(raw.get("visibility") or payload_value.get("visibility") or _default_visibility_for_kind(kind_value)).strip() or _default_visibility_for_kind(kind_value)
    requested_redaction = str(raw.get("redaction_level") or payload_value.get("redaction_level") or requested_visibility).strip() or requested_visibility
    presentation_policy = str(raw.get("presentation_policy") or payload_value.get("presentation_policy") or requested_visibility).strip() or requested_visibility
    storage_policy = str(raw.get("storage_policy") or payload_value.get("storage_policy") or "store_redacted").strip() or "store_redacted"
    payload_value.pop("visibility", None)
    payload_value.pop("redaction_level", None)
    payload_value.pop("presentation_policy", None)
    payload_value.pop("storage_policy", None)
    redacted_payload, redaction_meta = redact_payload(payload_value, mode=requested_redaction)

    model = RuntimeEvent(
        event_id=str(event_id or raw.get("event_id") or f"ev_{uuid4().hex[:10]}").strip() or f"ev_{uuid4().hex[:10]}",
        schema_version=str(raw.get("schema_version") or EVENT_SCHEMA_VERSION),
        event_kind=kind_value,
        ts=str(ts or raw.get("ts") or _now_iso()),
        process_id=process_value,
        objective_key=_first_non_empty(raw.get("objective_key"), raw.get("objectiveKey"), redacted_payload.get("objective_key"), redacted_payload.get("objectiveKey")),
        agent_id=_first_non_empty(raw.get("agent_id"), raw.get("agentId"), redacted_payload.get("agent_id"), redacted_payload.get("agentId")),
        scope=_first_non_empty(raw.get("scope"), redacted_payload.get("scope")),
        source_subsystem=_first_non_empty(raw.get("source_subsystem"), raw.get("sourceSubsystem"), raw.get("subsystem"), redacted_payload.get("source_subsystem"), redacted_payload.get("sourceSubsystem"), redacted_payload.get("subsystem"), classify_event_family(kind_value)) or classify_event_family(kind_value),
        correlation_id=_first_non_empty(raw.get("correlation_id"), raw.get("correlationId"), raw.get("trace_id"), raw.get("traceId"), redacted_payload.get("correlation_id"), redacted_payload.get("correlationId"), redacted_payload.get("trace_id"), redacted_payload.get("traceId")),
        causal_parent_ids=_coerce_parent_ids(raw.get("causal_parent_ids"), raw.get("causalParentIds"), raw.get("causal_parent_id"), raw.get("parent_event_id"), raw.get("parentEventId"), redacted_payload.get("causal_parent_ids"), redacted_payload.get("causalParentIds"), redacted_payload.get("causal_parent_id"), redacted_payload.get("parent_event_id"), redacted_payload.get("parentEventId")),
        session_key=_first_non_empty(raw.get("session_key"), raw.get("sessionKey"), raw.get("session_id"), raw.get("sessionId"), redacted_payload.get("session_key"), redacted_payload.get("sessionKey"), redacted_payload.get("session_id"), redacted_payload.get("sessionId")),
        repo_path=_first_non_empty(raw.get("repo_path"), raw.get("repoPath"), redacted_payload.get("repo_path"), redacted_payload.get("repoPath")),
        visibility=requested_visibility,
        redaction_level=requested_redaction,
        storage_policy=storage_policy,
        presentation_policy=presentation_policy,
        state_class="raw_evidence",
        family=classify_event_family(kind_value),
        payload=redacted_payload,
        lineage={
            "schema_version": LINEAGE_SCHEMA_VERSION,
            "event_ref": str(event_id or raw.get("event_id") or "").strip() or None,
            "redaction": redaction_meta,
        },
    )
    out = model.model_dump()
    out["kind"] = out["event_kind"]
    return out


def normalize_runtime_events(events: Iterable[JsonDict]) -> List[JsonDict]:
    out: List[JsonDict] = []
    for event in events or []:
        if not isinstance(event, dict):
            continue
        out.append(normalize_runtime_event(event))
    return out


def validate_state_class_collection(rows: Iterable[JsonDict], *, expected_state_class: str, require_lineage: bool = False) -> List[JsonDict]:
    expected = str(expected_state_class or "").strip()
    if expected not in STATE_CLASSES:
        raise ValueError(f"unknown_state_class:{expected}")
    validated: List[JsonDict] = []
    for idx, row in enumerate(rows or []):
        if not isinstance(row, dict):
            raise ValueError(f"invalid_row:{expected}:{idx}")
        actual = str(row.get("state_class") or "").strip()
        if actual != expected:
            raise ValueError(f"state_class_mismatch:{expected}:{idx}:{actual or 'missing'}")
        if require_lineage and not isinstance(row.get("lineage"), dict):
            raise ValueError(f"missing_lineage:{expected}:{idx}")
        validated.append(dict(row))
    return validated


def capability_matrix() -> JsonDict:
    redaction_mode = _mode_env("EVIDENCE_REDACTION_MODE", "operator_safe")
    layers = [
        CapabilityLayer(
            layer="event_capture",
            mode=_mode_env("EVIDENCE_EVENT_CAPTURE_MODE", "enabled"),
            enabled=_bool_env("EVIDENCE_EVENT_CAPTURE_ENABLED", True),
            reason="controls canonical runtime event capture and normalization",
            source="env",
            controls={"env": ["EVIDENCE_EVENT_CAPTURE_ENABLED", "EVIDENCE_EVENT_CAPTURE_MODE"]},
        ),
        CapabilityLayer(
            layer="derived_state_generation",
            mode=_mode_env("EVIDENCE_DERIVED_STATE_MODE", "enabled"),
            enabled=_bool_env("EVIDENCE_DERIVED_STATE_ENABLED", True),
            reason="controls inferred state facts and lineage derivation",
            source="env",
            controls={"env": ["EVIDENCE_DERIVED_STATE_ENABLED", "EVIDENCE_DERIVED_STATE_MODE"]},
        ),
        CapabilityLayer(
            layer="codec_policy_adaptation",
            mode=_mode_env("EVIDENCE_CODEC_POLICY_MODE", "enabled"),
            enabled=_bool_env("EVIDENCE_CODEC_POLICY_ENABLED", True),
            reason="controls adaptive codec policy and archetype-aware routing priors",
            source="env",
            controls={"env": ["EVIDENCE_CODEC_POLICY_ENABLED", "EVIDENCE_CODEC_POLICY_MODE"]},
        ),
        CapabilityLayer(
            layer="codec_rollup_promotion",
            mode=_mode_env("EVIDENCE_CODEC_ROLLUP_MODE", "enabled"),
            enabled=_bool_env("EVIDENCE_CODEC_ROLLUP_ENABLED", True),
            reason="controls codec memory rollup emission and durable promotion",
            source="env",
            controls={"env": ["EVIDENCE_CODEC_ROLLUP_ENABLED", "EVIDENCE_CODEC_ROLLUP_MODE"]},
        ),
        CapabilityLayer(
            layer="operator_override_enforcement",
            mode=_mode_env("EVIDENCE_OPERATOR_OVERRIDE_MODE", "enabled"),
            enabled=_bool_env("EVIDENCE_OPERATOR_OVERRIDE_ENABLED", True),
            reason="controls explicit operator override surface and precedence",
            source="env",
            controls={"env": ["EVIDENCE_OPERATOR_OVERRIDE_ENABLED", "EVIDENCE_OPERATOR_OVERRIDE_MODE"]},
        ),
        CapabilityLayer(
            layer="ui_live_trace_rendering",
            mode=_mode_env("EVIDENCE_UI_LIVE_TRACE_MODE", "enabled"),
            enabled=_bool_env("EVIDENCE_UI_LIVE_TRACE_ENABLED", True),
            reason="controls Mission Control live evidence panes and grouped execution streams",
            source="env",
            controls={"env": ["EVIDENCE_UI_LIVE_TRACE_ENABLED", "EVIDENCE_UI_LIVE_TRACE_MODE"]},
        ),
        CapabilityLayer(
            layer="redaction_mode",
            mode=redaction_mode,
            enabled=True,
            reason="controls storage/display redaction for runtime evidence payloads",
            source="env",
            controls={"env": ["EVIDENCE_REDACTION_MODE"]},
        ),
    ]
    return {
        "version": "cortex.evidence.capability_matrix.v1",
        "generated_at": _now_iso(),
        "layers": [row.model_dump() for row in layers],
        "redaction_levels": list(REDaction_LEVELS),
        "state_classes": list(STATE_CLASSES),
    }
