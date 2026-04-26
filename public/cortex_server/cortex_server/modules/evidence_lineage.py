from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from cortex_server.models.evidence import CodecMemoryFact, DerivedStateFact, OperatorOverride
from cortex_server.modules.evidence_governance import LINEAGE_SCHEMA_VERSION, capability_matrix, normalize_runtime_events, redact_payload, validate_state_class_collection


JsonDict = Dict[str, Any]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _fact_id(prefix: str, *parts: Any) -> str:
    joined = "|".join(str(part or "") for part in parts)
    return f"{prefix}_{hashlib.sha1(joined.encode('utf-8')).hexdigest()[:12]}"


def _event_ids(events: Iterable[JsonDict], *, kind_prefix: Optional[str] = None, limit: int = 8) -> List[str]:
    out: List[str] = []
    for row in list(events or [])[::-1]:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("event_kind") or row.get("kind") or "")
        if kind_prefix and not kind.startswith(kind_prefix):
            continue
        event_id = str(row.get("event_id") or "").strip()
        if event_id and event_id not in out:
            out.append(event_id)
        if len(out) >= max(1, int(limit or 8)):
            break
    return out


def build_derived_state_facts(
    *,
    process: Optional[JsonDict],
    events: Iterable[JsonDict],
    objective: Optional[JsonDict] = None,
    roadmap_detail: Optional[JsonDict] = None,
    delivery_detail: Optional[JsonDict] = None,
) -> List[JsonDict]:
    controls = capability_matrix()
    layer = next((row for row in (controls.get("layers") or []) if row.get("layer") == "derived_state_generation"), {})
    if not bool(layer.get("enabled", True)):
        return []

    process = dict(process or {})
    objective = dict(objective or {})
    roadmap_detail = dict(roadmap_detail or {})
    delivery_detail = dict(delivery_detail or {})
    normalized_events = normalize_runtime_events(events)
    generated_at = _now_iso()
    subject_ref = str(process.get("process_id") or objective.get("process_id") or objective.get("objective_key") or "unknown")
    out: List[JsonDict] = []

    status = str(objective.get("status") or process.get("status") or "").strip()
    if status:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "status"),
                fact_kind="process_status",
                subject_ref=subject_ref,
                value=status,
                confidence=0.98,
                freshness_seconds=30,
                observed_window="latest_process_view",
                source_event_ids=_event_ids(normalized_events, limit=6),
                source_subsystem="mission_control",
                generated_at=generated_at,
                rationale="derived from current process/objective view",
            ).model_dump()
        )

    active_nodes = list((process.get("active_nodes") or []))
    if active_nodes:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "active_nodes"),
                fact_kind="active_nodes",
                subject_ref=subject_ref,
                value=active_nodes,
                confidence=0.9,
                freshness_seconds=60,
                observed_window="current_runtime_snapshot",
                source_event_ids=_event_ids(normalized_events, kind_prefix="node_", limit=8),
                source_subsystem="runtime",
                generated_at=generated_at,
                rationale="compiled from process active node snapshot",
            ).model_dump()
        )

    waiting_nodes = list((process.get("waiting_nodes") or []))
    if waiting_nodes:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "waiting_nodes"),
                fact_kind="waiting_nodes",
                subject_ref=subject_ref,
                value=waiting_nodes,
                confidence=0.88,
                freshness_seconds=60,
                observed_window="current_runtime_snapshot",
                source_event_ids=_event_ids(normalized_events, limit=8),
                source_subsystem="runtime",
                generated_at=generated_at,
                rationale="compiled from process waiting node snapshot",
            ).model_dump()
        )

    current_phase = dict(objective.get("current_phase") or {})
    phase_value = current_phase.get("delivery_stage") or current_phase.get("roadmap_phase_id")
    if phase_value:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "phase", phase_value),
                fact_kind="current_phase",
                subject_ref=subject_ref,
                value=phase_value,
                confidence=0.86,
                freshness_seconds=90,
                observed_window="mission_control_objective_view",
                source_event_ids=_event_ids(normalized_events, limit=8),
                source_subsystem="mission_control",
                generated_at=generated_at,
                rationale="inferred current phase from objective projection",
            ).model_dump()
        )

    active_worker = (objective.get("active_worker") or {}).get("agent_id")
    if active_worker:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "active_worker", active_worker),
                fact_kind="active_worker",
                subject_ref=subject_ref,
                value=active_worker,
                confidence=0.84,
                freshness_seconds=60,
                observed_window="mission_control_objective_view",
                source_event_ids=_event_ids(normalized_events, limit=8),
                source_subsystem="mission_control",
                generated_at=generated_at,
                rationale="inferred from worker roster and objective active worker projection",
            ).model_dump()
        )

    blockers = list(objective.get("blockers") or [])
    if blockers:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "blocker_count", len(blockers)),
                fact_kind="blocker_count",
                subject_ref=subject_ref,
                value=len(blockers),
                confidence=0.9,
                freshness_seconds=60,
                observed_window="shared_state_projection",
                source_event_ids=_event_ids(normalized_events, limit=8),
                source_subsystem="mission_control",
                generated_at=generated_at,
                rationale="counted current blockers from shared-state projection",
            ).model_dump()
        )

    task_states = ((roadmap_detail.get("state") or {}).get("task_states") or []) if isinstance((roadmap_detail.get("state") or {}), dict) else []
    active_tasks = [row for row in task_states if isinstance(row, dict) and str(row.get("status") or "") in {"active", "blocked", "in_progress"}]
    if active_tasks:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "active_tasks"),
                fact_kind="active_tasks",
                subject_ref=subject_ref,
                value=[{"task_id": row.get("task_id"), "status": row.get("status"), "assigned_agent_id": row.get("assigned_agent_id")} for row in active_tasks[:8]],
                confidence=0.87,
                freshness_seconds=90,
                observed_window="roadmap_state",
                source_event_ids=_event_ids(normalized_events, limit=10),
                source_subsystem="roadmap",
                generated_at=generated_at,
                rationale="compiled from roadmap task state snapshot",
            ).model_dump()
        )

    release_stage = ((objective.get("delivery") or {}).get("release_stage") or (delivery_detail.get("release_state") or {}).get("release_stage"))
    if release_stage:
        out.append(
            DerivedStateFact(
                fact_id=_fact_id("fact", subject_ref, "release_stage", release_stage),
                fact_kind="release_stage",
                subject_ref=subject_ref,
                value=release_stage,
                confidence=0.88,
                freshness_seconds=120,
                observed_window="delivery_state",
                source_event_ids=_event_ids(normalized_events, limit=8),
                source_subsystem="delivery",
                generated_at=generated_at,
                rationale="derived from delivery projection",
            ).model_dump()
        )

    return out


def build_operator_overrides(*, detail: Optional[JsonDict], process_id: Optional[str] = None) -> List[JsonDict]:
    controls = capability_matrix()
    layer = next((row for row in (controls.get("layers") or []) if row.get("layer") == "operator_override_enforcement"), {})
    if not bool(layer.get("enabled", True)):
        return []

    detail = dict(detail or {})
    objective = dict(detail.get("objective") or {})
    shared_state = dict(objective.get("shared_state") or {})
    overrides_root = dict(shared_state.get("operator_overrides") or {})
    mission_control = dict(overrides_root.get("mission_control") or {})
    generated_at = _now_iso()
    scope = str(process_id or objective.get("process_id") or objective.get("objective_key") or "objective")
    rows: List[JsonDict] = []

    acknowledged = dict(mission_control.get("acknowledged_blockers") or {})
    for fingerprint, row in acknowledged.items():
        if not isinstance(row, dict):
            continue
        rows.append(
            OperatorOverride(
                override_id=_fact_id("override", scope, "blocker", fingerprint),
                scope=scope,
                override_kind="acknowledge_blocker",
                value={"fingerprint": fingerprint, "note": row.get("note")},
                actor=str(row.get("actor") or "operator"),
                reason=str(row.get("note") or "blocker_acknowledged") or "blocker_acknowledged",
                created_at=str(row.get("acknowledged_at") or generated_at),
                source_surface="mission_control",
            ).model_dump()
        )

    process = dict(objective.get("process") or {})
    if process and process.get("enabled") is False:
        rows.append(
            OperatorOverride(
                override_id=_fact_id("override", scope, "pause"),
                scope=scope,
                override_kind="pause_process",
                value={"enabled": False},
                actor="operator",
                reason="process_paused",
                created_at=str(process.get("updated_at") or generated_at),
                source_surface="mission_control",
            ).model_dump()
        )

    return rows


def build_codec_memory_facts(*, session_key: Optional[str], codec_state: Optional[JsonDict]) -> List[JsonDict]:
    state = dict(codec_state or {})
    if not session_key or not state:
        return []
    generated_at = str(state.get("generated_at") or _now_iso())
    source_refs = list(state.get("source_refs") or [])
    utility_scores = (((state.get("utility_state") or {}).get("bucket_scores") or {}) if isinstance((state.get("utility_state") or {}).get("bucket_scores"), dict) else {})
    promotion = dict(state.get("promotion_state") or {})

    def _bucket_conf(bucket: str) -> float:
        row = dict(utility_scores.get(bucket) or {})
        return round(min(0.99, max(0.35, float(row.get("avg_reward", 0.0) or 0.0) + 0.45)), 3)

    def _bucket_priority(bucket: str) -> float:
        row = dict(utility_scores.get(bucket) or {})
        summary = dict((state.get("utility_state") or {}).get("summary") or {})
        bucket_summary = dict(summary.get(bucket) or {}) if isinstance(summary.get(bucket), dict) else {}
        return round(float(bucket_summary.get("retention_priority") or row.get("retention_priority") or 0.0), 3)

    bucket_map = [
        ("preference", "learned_preference", (state.get("identity_state") or {}).get("preferences") or [], "preferences"),
        ("active_project", "learned_preference", (state.get("project_state") or {}).get("active_projects") or [], "active_projects"),
        ("active_goal", "learned_preference", (state.get("project_state") or {}).get("active_goals") or [], "active_goals"),
        ("open_loop", "learned_preference", (state.get("project_state") or {}).get("open_loops") or [], "open_loops"),
        ("durable_fact", "learned_preference", (state.get("world_state") or {}).get("durable_facts") or [], "durable_facts"),
        ("pattern", "learned_preference", (state.get("failure_state") or {}).get("patterns") or [], "patterns"),
        ("lesson", "learned_preference", (state.get("failure_state") or {}).get("lessons") or [], "lessons"),
    ]
    out: List[JsonDict] = []
    for memory_kind, state_class, values, bucket in bucket_map:
        for idx, value in enumerate(values[:8]):
            out.append(
                CodecMemoryFact(
                    memory_id=_fact_id("memory", session_key, bucket, idx, value),
                    memory_kind=memory_kind,
                    value=value,
                    confidence=_bucket_conf(bucket),
                    durability_class="durable" if promotion else "session",
                    retention_priority=_bucket_priority(bucket),
                    source_refs=source_refs[:12] or [{"session_key": session_key, "source_event_count": state.get("source_event_count", 0)}],
                    rollup_method="codec_rollup",
                    session_count=max(1, int((((state.get("rollup_state") or {}).get("session_count")) or 1))),
                    revision_chain=[{"generated_at": generated_at, "bucket": bucket}],
                    supersedes=[],
                    generated_at=generated_at,
                    state_class=state_class,
                ).model_dump()
            )
    return out


def build_codec_memory_lineage(*, memory_id: str, session_key: Optional[str], codec_state: Optional[JsonDict]) -> Optional[JsonDict]:
    target_id = str(memory_id or "").strip()
    if not target_id:
        return None
    memories = validate_state_class_collection(
        build_codec_memory_facts(session_key=session_key, codec_state=codec_state),
        expected_state_class="learned_preference",
    )
    match = next((row for row in memories if str(row.get("memory_id") or "").strip() == target_id), None)
    if not match:
        return None
    source_refs = [dict(row) for row in (match.get("source_refs") or []) if isinstance(row, dict)]
    source_event_ids: List[str] = []
    for row in source_refs:
        for key in ("event_id", "source_event_id"):
            text = str(row.get(key) or "").strip()
            if text and text not in source_event_ids:
                source_event_ids.append(text)
        for key in ("event_ids", "source_event_ids"):
            for item in row.get(key) or []:
                text = str(item or "").strip()
                if text and text not in source_event_ids:
                    source_event_ids.append(text)
    return {
        "success": True,
        "schema_version": LINEAGE_SCHEMA_VERSION,
        "generated_at": _now_iso(),
        "memory_id": target_id,
        "session_key": session_key,
        "memory": match,
        "lineage": {
            "schema_version": LINEAGE_SCHEMA_VERSION,
            "source_refs": source_refs,
            "source_event_ids": source_event_ids,
            "rollup_method": match.get("rollup_method"),
            "revision_chain": list(match.get("revision_chain") or []),
            "supersedes": list(match.get("supersedes") or []),
        },
    }


def build_lineage_bundle(
    *,
    process: Optional[JsonDict],
    events: Iterable[JsonDict],
    objective_detail: Optional[JsonDict] = None,
    codec_state: Optional[JsonDict] = None,
    session_key: Optional[str] = None,
) -> JsonDict:
    detail = dict(objective_detail or {})
    objective = dict(detail.get("objective") or {})
    roadmap_detail = dict(detail.get("roadmap_detail") or {})
    delivery_detail = dict(detail.get("delivery_detail") or {})
    normalized_events = normalize_runtime_events(events)
    observed = []
    for row in normalized_events:
        redacted_payload, redaction_meta = redact_payload(row.get("payload") or {}, mode="operator_safe")
        observed.append(
            {
                **row,
                "payload": redacted_payload,
                "lineage": {
                    **dict(row.get("lineage") or {}),
                    "schema_version": LINEAGE_SCHEMA_VERSION,
                    "redaction": redaction_meta,
                },
            }
        )
    inferred = build_derived_state_facts(process=process, events=normalized_events, objective=objective, roadmap_detail=roadmap_detail, delivery_detail=delivery_detail)
    learned = build_codec_memory_facts(session_key=session_key, codec_state=codec_state)
    overrides = build_operator_overrides(detail=detail, process_id=str((process or {}).get("process_id") or objective.get("process_id") or ""))
    observed = validate_state_class_collection(observed, expected_state_class="raw_evidence", require_lineage=True)
    inferred = validate_state_class_collection(inferred, expected_state_class="inferred_state")
    learned = validate_state_class_collection(learned, expected_state_class="learned_preference")
    overrides = validate_state_class_collection(overrides, expected_state_class="operator_override")
    return {
        "success": True,
        "schema_version": LINEAGE_SCHEMA_VERSION,
        "generated_at": _now_iso(),
        "classes": {
            "observed_evidence": observed,
            "inferred_state": inferred,
            "learned_memory": learned,
            "operator_overrides": overrides,
        },
        "summary": {
            "observed_count": len(observed),
            "inferred_count": len(inferred),
            "learned_count": len(learned),
            "override_count": len(overrides),
        },
    }
