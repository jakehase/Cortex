from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


CORTEX_AGENT_WORK_HANDOFF_SCHEMA = "cortex.agent_work_handoff.v0"
AGENT_WORK_SPEC_SCHEMA = "claw.agent_work_spec.v0"
AGENT_WORK_DEFAULT_RUNTIME = {
    "defaultRunner": "objective_controller",
    "defaultRunnerScript": "apps/system-benchmark/run-agent-work-objective-controller.mjs",
    "defaultCommand": "node apps/system-benchmark/run-agent-work-objective-controller.mjs <run_contract_or_agent_work_spec>",
    "finiteRunner": "finite_transfer_runner",
    "finiteRunnerScript": "apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs",
    "finiteCommand": "node apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs <run_contract>",
    "truthBoundary": "Agent Work v0.1 defaults to the objective controller. The finite transfer runner remains available only as an explicit single-wave runner.",
}


def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def _dedupe(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values or []:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


class AgentWorkPermissions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allow: List[str] = Field(default_factory=list)
    forbid: List[str] = Field(default_factory=list)

    @field_validator("allow", "forbid")
    @classmethod
    def _clean_list(cls, value: List[str]) -> List[str]:
        return _dedupe(value)


class AgentWorkSurface(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: Optional[str] = None
    goal: Optional[str] = None
    files: List[str] = Field(default_factory=list)
    verify: List[str] = Field(default_factory=list)
    templateIds: List[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("templateIds", "template_ids", "templates", "template", "uses", "use"),
    )
    deps: List[str] = Field(default_factory=list)
    lane: str = "cortex_agent_work"
    domain: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def _non_empty_id(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("surface id is required")
        return text

    @field_validator("files", "verify", "templateIds")
    @classmethod
    def _clean_string_lists(cls, value: List[str]) -> List[str]:
        return _dedupe(value)

    @field_validator("deps")
    @classmethod
    def _clean_deps(cls, value: List[str]) -> List[str]:
        return _dedupe(value)

    @model_validator(mode="after")
    def _defaults(self) -> "AgentWorkSurface":
        if not self.templateIds and (not self.files or not self.verify):
            raise ValueError("surface files and verify lists must be non-empty unless templateIds are present")
        if not self.label:
            self.label = self.id
        if not self.goal:
            self.goal = f"Complete {self.id}"
        if not self.domain:
            self.domain = self.id
        return self


class CortexAgentWorkHandoff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: str = CORTEX_AGENT_WORK_HANDOFF_SCHEMA
    generatedAt: str = Field(default_factory=_now_iso)
    source: str = "cortex"
    owner: Optional[str] = None
    session: Dict[str, Any] = Field(default_factory=dict)
    goalId: str
    objective: str
    repoPath: str
    benchmarkId: Optional[str] = None
    benchmarkTier: str = "execution_smoke"
    runId: Optional[str] = None
    artifactRoot: Optional[str] = None
    scoreboardPath: Optional[str] = None
    fidelity: str = "production_slice"
    requestedAgentCount: int = 1
    executionBoundary: str = "control_plane_allowed"
    stopCondition: str = "supervisor_green_or_blocker_report"
    permissions: AgentWorkPermissions = Field(default_factory=AgentWorkPermissions)
    requestedActions: List[str] = Field(default_factory=list)
    doneWhen: List[str] = Field(default_factory=list)
    replyAnchor: Optional[str] = None
    budgets: Dict[str, Any] = Field(default_factory=dict)
    wavePolicy: Dict[str, Any] = Field(default_factory=dict)
    expansionPolicy: Dict[str, Any] = Field(default_factory=dict)
    evidenceSchemas: List[Dict[str, Any]] = Field(default_factory=list)
    templates: List[Dict[str, Any]] = Field(default_factory=list)
    routeLevels: List[str] = Field(default_factory=list)
    memoryCitations: List[str] = Field(default_factory=list)
    surfaces: List[AgentWorkSurface]
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("schemaVersion")
    @classmethod
    def _schema(cls, value: str) -> str:
        if value != CORTEX_AGENT_WORK_HANDOFF_SCHEMA:
            raise ValueError(f"schemaVersion must be {CORTEX_AGENT_WORK_HANDOFF_SCHEMA}")
        return value

    @field_validator("goalId", "objective", "repoPath", "fidelity", "stopCondition")
    @classmethod
    def _non_empty_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("requestedAgentCount")
    @classmethod
    def _positive_agents(cls, value: int) -> int:
        if int(value) < 1:
            raise ValueError("requestedAgentCount must be >= 1")
        return int(value)

    @field_validator("requestedActions", "doneWhen", "routeLevels", "memoryCitations")
    @classmethod
    def _clean_lists(cls, value: List[str]) -> List[str]:
        return _dedupe(value)

    @field_validator("surfaces")
    @classmethod
    def _surfaces_required(cls, value: List[AgentWorkSurface]) -> List[AgentWorkSurface]:
        if not value:
            raise ValueError("at least one surface is required")
        return value

    @model_validator(mode="after")
    def _defaults(self) -> "CortexAgentWorkHandoff":
        if not self.benchmarkId:
            self.benchmarkId = self.goalId
        return self


def compile_handoff_to_agent_work_spec(handoff: CortexAgentWorkHandoff | Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(handoff, CortexAgentWorkHandoff):
        handoff = CortexAgentWorkHandoff(**handoff)
    return {
        "schemaVersion": AGENT_WORK_SPEC_SCHEMA,
        "generatedAt": handoff.generatedAt,
        "goalId": handoff.goalId,
        "outcome": handoff.objective,
        "benchmarkId": handoff.benchmarkId,
        "benchmarkTier": handoff.benchmarkTier,
        "runId": handoff.runId,
        "repoPath": handoff.repoPath,
        "artifactRoot": handoff.artifactRoot,
        "scoreboardPath": handoff.scoreboardPath,
        "fidelity": handoff.fidelity,
        "requestedAgentCount": handoff.requestedAgentCount,
        "executionBoundary": handoff.executionBoundary,
        "stopCondition": handoff.stopCondition,
        "permissions": handoff.permissions.model_dump() if hasattr(handoff.permissions, "model_dump") else handoff.permissions.dict(),
        "requestedActions": list(handoff.requestedActions),
        "doneWhen": list(handoff.doneWhen),
        "replyAnchor": handoff.replyAnchor,
        "budgets": dict(handoff.budgets),
        "wavePolicy": dict(handoff.wavePolicy),
        "expansionPolicy": dict(handoff.expansionPolicy),
        "evidenceSchemas": [dict(schema) for schema in handoff.evidenceSchemas],
        "templates": [dict(template) for template in handoff.templates],
        "surfaces": [
            {
                "id": surface.id,
                "label": surface.label,
                "goal": surface.goal,
                "files": list(surface.files),
                "verify": list(surface.verify),
                "templateIds": list(surface.templateIds),
                "deps": list(surface.deps),
                "lane": surface.lane,
                "domain": surface.domain,
                "metadata": {**dict(surface.metadata), "cortexSurface": True},
            }
            for surface in handoff.surfaces
        ],
        "metadata": {
            **dict(handoff.metadata),
            "source": "cortex_agent_work_handoff",
            "runtime": dict(AGENT_WORK_DEFAULT_RUNTIME),
            "cortex": {
                "handoffSchemaVersion": handoff.schemaVersion,
                "source": handoff.source,
                "owner": handoff.owner,
                "session": dict(handoff.session),
                "routeLevels": list(handoff.routeLevels),
                "memoryCitations": list(handoff.memoryCitations),
                "replyAnchor": handoff.replyAnchor,
            },
        },
    }


__all__ = [
    "AGENT_WORK_SPEC_SCHEMA",
    "CORTEX_AGENT_WORK_HANDOFF_SCHEMA",
    "AgentWorkPermissions",
    "AgentWorkSurface",
    "CortexAgentWorkHandoff",
    "compile_handoff_to_agent_work_spec",
]
