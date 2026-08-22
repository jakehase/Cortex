from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
import json
import re
import uuid

from fastapi import APIRouter
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
            "confidence",
            "daily_brief",
            "profile_snapshot",
        ],
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
