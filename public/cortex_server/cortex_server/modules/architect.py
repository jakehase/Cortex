"""Level 9: Architect — model-backed, advice-only design.

Given a design question (system architecture, data model, or infrastructure)
plus optional constraints and context, the Architect asks the model through
``level_model`` for a structured blueprint: explicit components, data flows,
data model, infrastructure, failure modes with mitigations, trade-offs, a
recommendation and open questions.  The output is validated against a strict
schema and returned with the provider receipt.  Nothing here writes files,
installs packages or changes the host: it is advice.  When the model is
unavailable the result says so and carries no blueprint.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Mapping, Optional

from pydantic import BaseModel, Field, model_validator

from cortex_server.modules.l9_cif import checklist_coverage

MAX_QUERY_CHARS = 8_000
MAX_CONTEXT_CHARS = 12_000

DesignKind = Literal["system", "data_model", "infrastructure", "auto"]


def _trim_to_schema(model_cls: Any, data: Any) -> Any:
    """Clip over-long strings and drop list items beyond the schema's limits.

    The model sometimes writes one item or a few characters too many; that is
    not a reason to throw the whole design away and pay for a repair call.
    Nothing is invented: only excess is removed. Nested models are handled by
    their own validators.
    """

    if not isinstance(data, dict):
        return data
    out = dict(data)
    for name, field in model_cls.model_fields.items():
        value = out.get(name)
        max_len = None
        for meta in field.metadata:
            max_len = getattr(meta, "max_length", None) or max_len
        if max_len is None:
            continue
        if isinstance(value, str) and len(value) > max_len:
            out[name] = value[: max_len - 1].rstrip() + "…"
        elif isinstance(value, list):
            items = value[:max_len]
            out[name] = [
                (item[:500].rstrip() if isinstance(item, str) and len(item) > 500 else item) for item in items
            ]
    return out


class _Trimmed(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _trim(cls, data: Any) -> Any:
        return _trim_to_schema(cls, data)


class Component(_Trimmed):
    name: str = Field(min_length=1, max_length=120)
    responsibility: str = Field(min_length=1, max_length=500)
    technology: Optional[str] = Field(default=None, max_length=200)
    scaling: Optional[str] = Field(default=None, max_length=300)


class DataFlow(_Trimmed):
    source: str = Field(min_length=1, max_length=120)
    target: str = Field(min_length=1, max_length=120)
    payload: str = Field(min_length=1, max_length=300)
    protocol: Optional[str] = Field(default=None, max_length=120)
    sync: Optional[Literal["sync", "async", "batch", "stream"]] = None


class Entity(_Trimmed):
    entity: str = Field(min_length=1, max_length=120)
    fields: List[str] = Field(default_factory=list, max_length=40)
    keys: List[str] = Field(default_factory=list, max_length=10)
    relationships: List[str] = Field(default_factory=list, max_length=12)
    notes: Optional[str] = Field(default=None, max_length=400)


class InfraResource(_Trimmed):
    resource: str = Field(min_length=1, max_length=160)
    purpose: str = Field(min_length=1, max_length=300)
    sizing: Optional[str] = Field(default=None, max_length=300)


class Risk(_Trimmed):
    scenario: str = Field(min_length=1, max_length=400)
    impact: str = Field(min_length=1, max_length=300)
    mitigation: str = Field(min_length=1, max_length=500)
    severity: Literal["low", "medium", "high"]


class TradeOff(_Trimmed):
    decision: str = Field(min_length=1, max_length=200)
    options: List[str] = Field(min_length=2, max_length=5)
    chosen: str = Field(min_length=1, max_length=200)
    pros: List[str] = Field(default_factory=list, max_length=6)
    cons: List[str] = Field(default_factory=list, max_length=6)
    rationale: str = Field(min_length=1, max_length=600)


class ArchitectDesign(_Trimmed):
    summary: str = Field(min_length=1, max_length=1200)
    design_type: Literal["system", "data_model", "infrastructure", "mixed"]
    assumptions: List[str] = Field(default_factory=list, max_length=10)
    components: List[Component] = Field(min_length=1, max_length=14)
    data_flows: List[DataFlow] = Field(default_factory=list, max_length=20)
    data_model: List[Entity] = Field(default_factory=list, max_length=14)
    infrastructure: List[InfraResource] = Field(default_factory=list, max_length=14)
    risks: List[Risk] = Field(min_length=1, max_length=12)
    tradeoffs: List[TradeOff] = Field(default_factory=list, max_length=6)
    recommendation: str = Field(min_length=1, max_length=1500)
    open_questions: List[str] = Field(default_factory=list, max_length=8)
    next_steps: List[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def _kind_specific(self) -> "ArchitectDesign":
        if self.design_type == "data_model" and not self.data_model:
            raise ValueError("data_model designs must include at least one entity in data_model")
        if self.design_type == "infrastructure" and not self.infrastructure:
            raise ValueError("infrastructure designs must include infrastructure resources")
        return self


class CompactArchitectDesign(ArchitectDesign):
    """In-turn blueprint: same shape, small enough to generate inside a chat turn."""

    summary: str = Field(min_length=1, max_length=600)
    assumptions: List[str] = Field(default_factory=list, max_length=4)
    components: List[Component] = Field(min_length=1, max_length=6)
    data_flows: List[DataFlow] = Field(default_factory=list, max_length=8)
    data_model: List[Entity] = Field(default_factory=list, max_length=5)
    infrastructure: List[InfraResource] = Field(default_factory=list, max_length=4)
    risks: List[Risk] = Field(min_length=1, max_length=4)
    tradeoffs: List[TradeOff] = Field(default_factory=list, max_length=2)
    recommendation: str = Field(min_length=1, max_length=700)
    open_questions: List[str] = Field(default_factory=list, max_length=3)
    next_steps: List[str] = Field(default_factory=list, max_length=4)


COMPACT_LIMITS = (
    "\nSIZE LIMITS (this answer is read inside a live chat turn; be dense, not exhaustive): summary <= 3 "
    "sentences; at most 6 components, 8 data_flows, 5 data_model entities (<= 10 fields each), 4 "
    "infrastructure resources, 4 risks, 2 tradeoffs, 3 open_questions, 4 next_steps; every free-text field "
    "<= 2 short sentences; recommendation <= 4 sentences. The whole JSON should be under 6000 characters."
)

ARCHITECT_SYSTEM = (
    "You are L9 Architect, a senior systems architect giving design ADVICE (you never write files or run "
    "anything). Produce a concrete, buildable design for the user's question that respects every stated "
    "constraint (scale, latency, RPO/RTO, budget, stack, team size, compliance). Name real component types and "
    "technologies when appropriate, and say explicitly when you are assuming something. Requirements:\n"
    "- components: each with a single clear responsibility; data_flows must reference component names.\n"
    "- data_model: entities with fields, keys and relationships (required when the question is about data).\n"
    "- infrastructure: concrete resources with sizing (required when the question is about infrastructure).\n"
    "- risks: realistic failure modes, each with impact, a concrete mitigation and severity.\n"
    "- tradeoffs: real alternatives that were considered, which was chosen and why.\n"
    "- recommendation: the design you would build first, referencing the user's constraints.\n"
    "- open_questions: what you would ask before committing.\n"
    "Do not pad lists; omit what does not apply. Return ONLY one JSON object with exactly these keys: summary, "
    "design_type (system|data_model|infrastructure|mixed), assumptions[], components[{name, responsibility, "
    "technology, scaling}], data_flows[{source, target, payload, protocol, sync(sync|async|batch|stream)}], "
    "data_model[{entity, fields[], keys[], relationships[], notes}], infrastructure[{resource, purpose, sizing}], "
    "risks[{scenario, impact, mitigation, severity(low|medium|high)}], tradeoffs[{decision, options[], chosen, "
    "pros[], cons[], rationale}], recommendation, open_questions[], next_steps[]."
)


def _consistency(design: Mapping[str, Any]) -> List[str]:
    names = {str(c.get("name", "")).strip().lower() for c in design.get("components") or []}
    warnings: List[str] = []
    for flow in design.get("data_flows") or []:
        for end in ("source", "target"):
            value = str(flow.get(end, "")).strip()
            if value and value.lower() not in names:
                warnings.append(f"data flow {end} '{value}' is not a listed component")
    return warnings[:10]


def build_prompt(query: str, *, kind: str, constraints: Optional[str], context: Optional[str],
                 current_stack: Optional[str]) -> str:
    parts = [f"Design question:\n{query.strip()}"]
    if kind and kind != "auto":
        parts.append(f"Requested design type: {kind}")
    if constraints:
        parts.append(f"Constraints:\n{constraints.strip()[:4000]}")
    if current_stack:
        parts.append(f"Current stack:\n{current_stack.strip()[:2000]}")
    if context:
        parts.append(f"Additional context:\n{context.strip()[:MAX_CONTEXT_CHARS]}")
    return "\n\n".join(parts)


async def design(
    query: str,
    *,
    principal_scope_key: str,
    kind: str = "auto",
    constraints: Optional[str] = None,
    context: Optional[str] = None,
    current_stack: Optional[str] = None,
    deadline_s: float = 90.0,
    compact: bool = False,
) -> Dict[str, Any]:
    """Model-backed blueprint. Returns success:false (no blueprint) on any model failure.

    compact=True is the in-turn variant used by the level adapter: tighter
    limits stated in the prompt and enforced by CompactArchitectDesign.
    """

    from cortex_server.modules import level_model

    text = str(query or "").strip()
    if not text:
        return {"success": False, "operation": "architect.design", "error": "query must be non-empty",
                "origin": "input_rejected"}
    prompt = build_prompt(text[:MAX_QUERY_CHARS], kind=kind, constraints=constraints, context=context,
                          current_stack=current_stack)
    result = await level_model.level_model_json(
        level=9,
        name="architect",
        system=ARCHITECT_SYSTEM + (COMPACT_LIMITS if compact else ""),
        prompt=prompt,
        principal_scope_key=principal_scope_key,
        schema=CompactArchitectDesign if compact else ArchitectDesign,
        deadline_s=deadline_s,
    )
    if not result.get("ok"):
        payload = level_model.unavailable_payload(result, operation="architect.design")
        payload["blueprint"] = None
        return payload
    blueprint = result.get("data") or {}
    return {
        "success": True,
        "operation": "architect.design",
        "origin": "model",
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
        "advice_only": True,
        "compact": bool(compact),
        "blueprint": blueprint,
        "consistency_warnings": _consistency(blueprint),
        "review_checklist": checklist_coverage(blueprint),
    }


class Architect:
    """Legacy accessor kept for imports; delegates to the real design path."""

    def __init__(self) -> None:
        self.level = 9
        self.name = "Architect"

    async def design(self, query: str, *, principal_scope_key: str, **kwargs: Any) -> Dict[str, Any]:
        return await design(query, principal_scope_key=principal_scope_key, **kwargs)

    def status(self) -> Dict[str, Any]:
        return {"level": self.level, "name": self.name, "mode": "advice_only_model_backed_design"}


_architect: Optional[Architect] = None


def get_architect() -> Architect:
    global _architect
    if _architect is None:
        _architect = Architect()
    return _architect
