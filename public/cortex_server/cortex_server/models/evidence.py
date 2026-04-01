from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RuntimeEvent(BaseModel):
    event_id: str
    schema_version: str = "cortex.runtime.event.v1"
    event_kind: str
    ts: str
    process_id: str
    objective_key: Optional[str] = None
    agent_id: Optional[str] = None
    scope: Optional[str] = None
    source_subsystem: str = "runtime"
    correlation_id: Optional[str] = None
    causal_parent_ids: List[str] = Field(default_factory=list)
    session_key: Optional[str] = None
    repo_path: Optional[str] = None
    visibility: str = "operator_safe"
    redaction_level: str = "operator_safe"
    storage_policy: str = "store_redacted"
    presentation_policy: str = "operator_safe"
    state_class: str = "raw_evidence"
    family: str = "runtime"
    payload: Dict[str, Any] = Field(default_factory=dict)
    lineage: Dict[str, Any] = Field(default_factory=dict)


class DerivedStateFact(BaseModel):
    fact_id: str
    fact_kind: str
    subject_ref: str
    value: Any
    confidence: float = 0.0
    freshness_seconds: Optional[int] = None
    observed_window: Optional[str] = None
    source_event_ids: List[str] = Field(default_factory=list)
    source_subsystem: str = "runtime"
    generated_at: str
    state_class: str = "inferred_state"
    rationale: Optional[str] = None


class CodecMemoryFact(BaseModel):
    memory_id: str
    memory_kind: str
    value: Any
    confidence: float = 0.0
    durability_class: str = "session"
    retention_priority: float = 0.0
    source_refs: List[Dict[str, Any]] = Field(default_factory=list)
    rollup_method: str = "codec_rollup"
    session_count: int = 1
    revision_chain: List[Dict[str, Any]] = Field(default_factory=list)
    supersedes: List[str] = Field(default_factory=list)
    generated_at: str
    state_class: str = "learned_preference"
    schema_version: str = "cortex.codec.memory.v1"


class OperatorOverride(BaseModel):
    override_id: str
    scope: str
    override_kind: str
    value: Any
    actor: str
    reason: str
    created_at: str
    expires_at: Optional[str] = None
    source_surface: str = "operator"
    supersedes: List[str] = Field(default_factory=list)
    state_class: str = "operator_override"


class CapabilityLayer(BaseModel):
    layer: str
    mode: str
    enabled: bool
    reason: str
    source: str
    controls: Dict[str, Any] = Field(default_factory=dict)
