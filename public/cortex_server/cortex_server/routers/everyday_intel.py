from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
import hashlib
import json
import re
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()

STATE_DIR = Path("/app/config/state/everyday_intel")
DECISIONS_FILE = STATE_DIR / "decisions.jsonl"

WORKSPACE = Path("/root/.openclaw/workspace")
USER_FILE = WORKSPACE / "USER.md"
MEMORY_FILE = WORKSPACE / "MEMORY.md"
MEMORY_DIR = WORKSPACE / "memory"

URGENT_WORDS = (
    "urgent",
    "asap",
    "immediately",
    "today",
    "deadline",
    "blocked",
    "failing",
    "down",
    "incident",
)

HEDGING_WORDS = (
    "maybe",
    "might",
    "possibly",
    "could",
    "uncertain",
    "not sure",
)


class PriorityItem(BaseModel):
    id: str
    text: str
    importance: int = Field(default=3, ge=1, le=5)
    due_iso: Optional[str] = None


class PrioritizeRequest(BaseModel):
    items: List[PriorityItem]
    now_iso: Optional[str] = None


class DecisionLogRequest(BaseModel):
    decision: str
    context: Optional[str] = ""
    expected_outcome: Optional[str] = ""
    review_after_days: int = Field(default=7, ge=1, le=90)
    tags: List[str] = Field(default_factory=list)


class DecisionResolveRequest(BaseModel):
    decision_id: str
    outcome: str
    score: int = Field(default=0, ge=-2, le=2)
    notes: Optional[str] = ""


class ConfidenceRequest(BaseModel):
    answer: str
    stakes: str = "normal"  # low|normal|high
    evidence_count: int = Field(default=0, ge=0, le=100)


ATTENTION_KINDS = {
    "user_committed",
    "owed_to_user",
    "waiting_approval",
    "cortex_can_prepare",
}
ATTENTION_STATUSES = {"candidate", "active", "resolved"}
WORKBENCH_DIMENSIONS = (
    "expected_benefit",
    "user_time",
    "ongoing_burden",
    "cost",
    "reversibility",
    "uncertainty",
)


class _StrictRequest(BaseModel):
    class Config:
        extra = "forbid"


class AttentionProposeRequest(_StrictRequest):
    kind: str
    summary: str = Field(min_length=3, max_length=600)
    source_ref: str = Field(min_length=1, max_length=1000)
    source_quote: str = Field(min_length=1, max_length=1200)
    external_action_requested: bool = False


class AttentionConfirmRequest(_StrictRequest):
    item_id: str = Field(min_length=1, max_length=128)
    confirmation_source_ref: str = Field(min_length=1, max_length=1000)
    confirmation_quote: str = Field(min_length=1, max_length=1200)
    confirmation_method: str = "exact_current_user_quote"
    confirmation_verified_by_plugin: bool = False


class AttentionResolveRequest(_StrictRequest):
    item_id: str = Field(min_length=1, max_length=128)
    resolution_note: str = Field(min_length=1, max_length=600)
    resolution_source_ref: str = Field(min_length=1, max_length=1000)
    resolution_quote: str = Field(min_length=1, max_length=1200)
    resolution_verified_by_plugin: bool = False


class AttentionViewRequest(_StrictRequest):
    include_candidates: bool = True
    include_resolved: bool = False


class WorkbenchOption(_StrictRequest):
    label: str = Field(min_length=1, max_length=180)
    expected_benefit: Optional[str] = Field(default=None, max_length=1200)
    user_time: Optional[str] = Field(default=None, max_length=1200)
    ongoing_burden: Optional[str] = Field(default=None, max_length=1200)
    cost: Optional[str] = Field(default=None, max_length=1200)
    reversibility: Optional[str] = Field(default=None, max_length=1200)
    uncertainty: Optional[str] = Field(default=None, max_length=1200)
    source_refs: List[str] = Field(default_factory=list, max_length=20)


class DecisionWorkbenchRequest(_StrictRequest):
    decision: str = Field(min_length=3, max_length=1200)
    options: List[WorkbenchOption] = Field(min_length=2, max_length=12)
    priorities: List[str] = Field(default_factory=list, max_length=20)
    priority_source_refs: List[str] = Field(default_factory=list, max_length=20)
    decision_changers: List[str] = Field(default_factory=list, max_length=30)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_state_dir() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _read_jsonl(path: Path) -> List[dict]:
    if not path.exists():
        return []
    rows: List[dict] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def _append_jsonl(path: Path, row: dict) -> None:
    _ensure_state_dir()
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _principal_key(request: Request) -> str:
    """Derive attention ownership only from authenticated transport identity."""

    principal = getattr(request.state, "cortex_principal", None)
    if principal is None or getattr(principal, "role", "") != "principal":
        raise HTTPException(status_code=403, detail="signed principal authorization required")
    dimensions = (
        str(getattr(principal, "credential_id", "") or ""),
        str(getattr(principal, "tenant_id", "") or ""),
        str(getattr(principal, "storage_workspace_id", "") or ""),
        str(getattr(principal, "agent_id", "") or ""),
        str(getattr(principal, "user_id", "") or ""),
        str(getattr(principal, "channel_id", "") or ""),
    )
    if not all(dimensions):
        raise HTTPException(status_code=403, detail="complete principal scope required")
    return hashlib.sha256(("cortex.everyday.principal.v1\0" + "\0".join(dimensions)).encode("utf-8")).hexdigest()


def _clean_source(value: str, field: str, maximum: int) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{field} is required")
    if len(cleaned) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} is too long")
    return cleaned


def _attention_latest(principal_key: str) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for row in _read_jsonl(DECISIONS_FILE):
        if row.get("record_type") != "attention":
            continue
        if row.get("principal_key") != principal_key:
            continue
        item_id = row.get("id")
        if isinstance(item_id, str) and item_id:
            latest[item_id] = row
    return latest


def _public_attention_row(row: dict) -> dict:
    allowed = (
        "id", "kind", "summary", "status", "source_ref", "source_quote",
        "created_at", "updated_at", "confirmed_at", "confirmation_source_ref",
        "confirmation_quote", "resolved_at", "resolution_note",
        "resolution_source_ref", "resolution_quote", "external_action_allowed",
    )
    return {key: row.get(key) for key in allowed if key in row}


def _workbench_value(value: Optional[str], source_refs: List[str]) -> dict:
    cleaned = str(value or "").strip()
    refs = [str(ref).strip() for ref in source_refs if str(ref).strip()][:20]
    if not cleaned:
        return {"value": None, "evidence_state": "missing", "source_refs": []}
    return {
        "value": cleaned,
        "evidence_state": "source_backed" if refs else "user_stated_or_unverified",
        "source_refs": refs,
    }


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _priority_score(item: PriorityItem, now: datetime) -> float:
    text_lower = item.text.lower()
    score = float(item.importance * 20)

    if any(w in text_lower for w in URGENT_WORDS):
        score += 25

    due = _parse_iso(item.due_iso)
    if due:
        delta_h = (due - now).total_seconds() / 3600.0
        if delta_h <= 0:
            score += 35
        elif delta_h <= 24:
            score += 25
        elif delta_h <= 72:
            score += 12

    return round(score, 2)


def _confidence_estimate(answer: str, stakes: str, evidence_count: int) -> dict:
    text = (answer or "").strip().lower()

    base = 0.68
    base += min(0.2, evidence_count * 0.04)

    hedge_hits = sum(1 for w in HEDGING_WORDS if w in text)
    base -= min(0.2, hedge_hits * 0.05)

    if stakes.lower() == "high":
        base -= 0.08
    elif stakes.lower() == "low":
        base += 0.04

    score = max(0.05, min(0.98, base))

    if score >= 0.8:
        band = "high"
    elif score >= 0.6:
        band = "medium"
    else:
        band = "low"

    factors = []
    if evidence_count < 2:
        factors.append("low_evidence")
    if hedge_hits > 0:
        factors.append("hedging_language_detected")
    if stakes.lower() == "high":
        factors.append("high_stakes_domain")

    return {
        "confidence_score": round(score, 2),
        "confidence_band": band,
        "uncertainty_factors": factors,
        "recommendation": "seek_more_validation" if band != "high" else "proceed_with_standard_checks",
    }


def _recent_memory_lines(max_lines: int = 12) -> List[str]:
    lines: List[str] = []
    if MEMORY_FILE.exists():
        mem = MEMORY_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
        lines.extend([x.strip() for x in mem if x.strip().startswith("-")][-6:])

    if MEMORY_DIR.exists():
        daily = sorted(MEMORY_DIR.glob("*.md"))
        for f in daily[-2:]:
            txt = f.read_text(encoding="utf-8", errors="ignore").splitlines()
            lines.extend([x.strip() for x in txt if x.strip().startswith("-")][-4:])

    return lines[-max_lines:]


@router.get("/status")
async def status():
    return {
        "success": True,
        "module": "everyday_intel",
        "capabilities": [
            "prioritize",
            "decision_log",
            "decision_review",
            "decision_resolve",
            "decision_workbench_qualitative",
            "source_backed_attention_lifecycle",
            "confidence",
            "daily_brief",
            "profile_snapshot",
        ],
    }


@router.post("/attention/propose")
async def attention_propose(req: AttentionProposeRequest, http_request: Request):
    principal_key = _principal_key(http_request)
    kind = str(req.kind or "").strip().lower()
    if kind not in ATTENTION_KINDS:
        raise HTTPException(status_code=422, detail="unsupported attention kind")
    if req.external_action_requested:
        raise HTTPException(status_code=422, detail="attention items cannot authorize external actions")
    now = _utc_now().isoformat()
    row = {
        "record_type": "attention",
        "id": str(uuid.uuid4()),
        "principal_key": principal_key,
        "kind": kind,
        "summary": str(req.summary).strip(),
        "status": "candidate",
        "source_ref": _clean_source(req.source_ref, "source_ref", 1000),
        "source_quote": _clean_source(req.source_quote, "source_quote", 1200),
        "external_action_allowed": False,
        "created_at": now,
        "updated_at": now,
    }
    _append_jsonl(DECISIONS_FILE, row)
    return {
        "success": True,
        "item": _public_attention_row(row),
        "activation_required": True,
        "activation_policy": "exact current-user quote verified by the default plugin path",
    }


@router.post("/attention/confirm")
async def attention_confirm(req: AttentionConfirmRequest, http_request: Request):
    principal_key = _principal_key(http_request)
    latest = _attention_latest(principal_key)
    current = latest.get(str(req.item_id))
    if current is None:
        raise HTTPException(status_code=404, detail="attention item not found")
    if current.get("status") != "candidate":
        raise HTTPException(status_code=409, detail="only candidate attention items can be confirmed")
    if req.confirmation_method != "exact_current_user_quote" or not req.confirmation_verified_by_plugin:
        raise HTTPException(status_code=422, detail="plugin-verified exact current-user confirmation is required")
    now = _utc_now().isoformat()
    row = {
        **current,
        "record_type": "attention",
        "principal_key": principal_key,
        "status": "active",
        "confirmed_at": now,
        "updated_at": now,
        "confirmation_source_ref": _clean_source(req.confirmation_source_ref, "confirmation_source_ref", 1000),
        "confirmation_quote": _clean_source(req.confirmation_quote, "confirmation_quote", 1200),
        "confirmation_method": "exact_current_user_quote",
        "confirmation_verified_by_plugin": True,
        "external_action_allowed": False,
    }
    _append_jsonl(DECISIONS_FILE, row)
    return {"success": True, "item": _public_attention_row(row)}


@router.post("/attention/resolve")
async def attention_resolve(req: AttentionResolveRequest, http_request: Request):
    principal_key = _principal_key(http_request)
    latest = _attention_latest(principal_key)
    current = latest.get(str(req.item_id))
    if current is None:
        raise HTTPException(status_code=404, detail="attention item not found")
    if current.get("status") not in {"candidate", "active"}:
        raise HTTPException(status_code=409, detail="attention item is already resolved")
    if not req.resolution_verified_by_plugin:
        raise HTTPException(status_code=422, detail="plugin-verified resolution source is required")
    now = _utc_now().isoformat()
    row = {
        **current,
        "record_type": "attention",
        "principal_key": principal_key,
        "status": "resolved",
        "resolved_at": now,
        "updated_at": now,
        "resolution_note": str(req.resolution_note).strip(),
        "resolution_source_ref": _clean_source(req.resolution_source_ref, "resolution_source_ref", 1000),
        "resolution_quote": _clean_source(req.resolution_quote, "resolution_quote", 1200),
        "resolution_verified_by_plugin": True,
        "external_action_allowed": False,
    }
    _append_jsonl(DECISIONS_FILE, row)
    return {"success": True, "item": _public_attention_row(row)}


@router.post("/attention/view")
async def attention_view(req: AttentionViewRequest, http_request: Request):
    principal_key = _principal_key(http_request)
    rows = list(_attention_latest(principal_key).values())
    rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    grouped = {
        "active": [_public_attention_row(row) for row in rows if row.get("status") == "active"],
        "candidates": [
            _public_attention_row(row) for row in rows
            if req.include_candidates and row.get("status") == "candidate"
        ],
        "resolved": [
            _public_attention_row(row) for row in rows
            if req.include_resolved and row.get("status") == "resolved"
        ],
    }
    return {
        "success": True,
        "view": grouped,
        "counts": {key: len(value) for key, value in grouped.items()},
        "policy": {
            "candidate_is_not_an_obligation": True,
            "active_requires_explicit_confirmation": True,
            "external_actions": "never authorized by attention state",
        },
    }


@router.post("/decision/workbench")
async def decision_workbench(req: DecisionWorkbenchRequest, http_request: Request):
    # Authenticate even though this surface is compute-only, so source-backed
    # preferences and option material cannot cross principal boundaries.
    _principal_key(http_request)
    normalized_options = []
    missing_evidence = []
    for option in req.options:
        refs = [str(ref).strip() for ref in option.source_refs if str(ref).strip()][:20]
        dimensions = {
            dimension: _workbench_value(getattr(option, dimension), refs)
            for dimension in WORKBENCH_DIMENSIONS
        }
        for dimension, state in dimensions.items():
            if state["evidence_state"] == "missing":
                missing_evidence.append({"option": option.label, "dimension": dimension})
        normalized_options.append({
            "label": option.label,
            "dimensions": dimensions,
            "missing_dimensions": [
                dimension for dimension, state in dimensions.items()
                if state["evidence_state"] == "missing"
            ],
        })
    priorities = [str(value).strip() for value in req.priorities if str(value).strip()][:20]
    priority_refs = [str(value).strip() for value in req.priority_source_refs if str(value).strip()][:20]
    decision_changers = [str(value).strip() for value in req.decision_changers if str(value).strip()][:30]
    decision_changers.extend(
        f"Evidence for {row['dimension']} for {row['option']}"
        for row in missing_evidence
    )
    decision_changers = list(dict.fromkeys(decision_changers))[:60]
    return {
        "success": True,
        "workbench": {
            "decision": req.decision,
            "options": normalized_options,
            "priorities": {
                "values": priorities,
                "evidence_state": (
                    "source_backed" if priorities and priority_refs
                    else "user_stated_or_unverified" if priorities
                    else "missing"
                ),
                "source_refs": priority_refs,
            },
            "missing_evidence": missing_evidence,
            "what_could_change_the_recommendation": decision_changers,
            "recommendation": None,
            "recommendation_boundary": "No winner is selected without source-backed option facts and explicit user priorities.",
            "scoring": {
                "numeric_scores": False,
                "weighted_ranking": False,
                "fabricated_precision": False,
            },
        },
    }


@router.post("/prioritize")
async def prioritize(req: PrioritizeRequest):
    now = _parse_iso(req.now_iso) or _utc_now()
    scored = []
    for it in req.items:
        scored.append({
            "id": it.id,
            "text": it.text,
            "importance": it.importance,
            "due_iso": it.due_iso,
            "priority_score": _priority_score(it, now),
        })

    scored.sort(key=lambda x: x["priority_score"], reverse=True)
    return {
        "success": True,
        "ordered": scored,
        "policy": "importance + urgency keywords + due-time proximity",
    }


@router.post("/decision/log")
async def decision_log(req: DecisionLogRequest):
    now = _utc_now()
    row = {
        "record_type": "decision",
        "id": str(uuid.uuid4()),
        "created_at": now.isoformat(),
        "review_due": (now + timedelta(days=req.review_after_days)).isoformat(),
        "decision": req.decision,
        "context": req.context,
        "expected_outcome": req.expected_outcome,
        "tags": req.tags,
        "resolved": False,
    }
    _append_jsonl(DECISIONS_FILE, row)
    return {"success": True, "decision_id": row["id"], "review_due": row["review_due"]}


@router.get("/decision/review")
async def decision_review(include_all: bool = False):
    now = _utc_now()
    rows = _read_jsonl(DECISIONS_FILE)

    latest_by_id: dict[str, dict] = {}
    for r in rows:
        if r.get("record_type", "decision") != "decision":
            continue
        rid = r.get("id")
        if isinstance(rid, str):
            latest_by_id[rid] = r

    pending = []
    for row in latest_by_id.values():
        if row.get("resolved") is True:
            continue
        due = _parse_iso(row.get("review_due"))
        if include_all or (due and due <= now):
            pending.append(row)

    pending.sort(key=lambda x: x.get("review_due") or "")
    return {"success": True, "pending_reviews": pending, "count": len(pending)}


@router.post("/decision/resolve")
async def decision_resolve(req: DecisionResolveRequest):
    rows = _read_jsonl(DECISIONS_FILE)
    updated = False
    now = _utc_now().isoformat()

    for row in rows:
        if row.get("record_type", "decision") != "decision":
            continue
        if row.get("id") == req.decision_id and row.get("resolved") is not True:
            row["resolved"] = True
            row["resolved_at"] = now
            row["outcome"] = req.outcome
            row["outcome_score"] = req.score
            row["outcome_notes"] = req.notes
            updated = True

    if not updated:
        return {"success": False, "error": "decision_id not found or already resolved"}

    _ensure_state_dir()
    DECISIONS_FILE.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return {"success": True, "resolved": True, "decision_id": req.decision_id}


@router.post("/confidence")
async def confidence(req: ConfidenceRequest):
    est = _confidence_estimate(req.answer, req.stakes, req.evidence_count)
    return {"success": True, **est}


@router.get("/profile/snapshot")
async def profile_snapshot():
    user = USER_FILE.read_text(encoding="utf-8", errors="ignore") if USER_FILE.exists() else ""
    lines = _recent_memory_lines()

    name_match = re.search(r"\*\*Name:\*\*\s*(.*)", user)
    call_match = re.search(r"\*\*What to call them:\*\*\s*(.*)", user)

    return {
        "success": True,
        "name": (name_match.group(1).strip() if name_match else "") or None,
        "preferred_name": (call_match.group(1).strip() if call_match else "") or None,
        "recent_signals": lines,
    }


@router.get("/daily/brief")
async def daily_brief(max_items: int = 6):
    reviews = await decision_review(include_all=False)
    pending = (reviews or {}).get("pending_reviews", [])[: max(1, min(max_items, 12))]
    memory_signals = _recent_memory_lines(max_lines=max_items)

    return {
        "success": True,
        "brief": {
            "focus_items": [p.get("decision") for p in pending if p.get("decision")],
            "due_decisions": len(pending),
            "memory_signals": memory_signals,
            "generated_at": _utc_now().isoformat(),
        },
    }
