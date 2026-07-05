from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from cortex_server.modules.reasoning_store import list_docs, replace_namespace_docs


DEFAULT_STATE_PATH = Path(os.getenv("REASONING_APPROVALS_STATE_PATH", "/opt/clawdbot/state/reasoning_approvals.json"))
DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
ENABLE_LEGACY_JSON_FALLBACK = str(os.getenv("REASONING_APPROVALS_ENABLE_LEGACY_JSON_FALLBACK", "0")).strip().lower() in {"1", "true", "yes", "on"}
_NAMESPACE = "approval_grants"
_LOCK = threading.RLock()


class ReasoningApprovalError(ValueError):
    pass



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _state_path() -> Path:
    return Path(str(DEFAULT_STATE_PATH))



def _db_path() -> Path:
    return Path(str(DEFAULT_DB_PATH))



def _default_state() -> Dict[str, Any]:
    return {
        "version": "cortex.reasoning.approvals.v1",
        "updated_at": _now_iso(),
        "grants": [],
    }



def _legacy_state() -> Optional[Dict[str, Any]]:
    path = _state_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("version", "cortex.reasoning.approvals.v1")
            data.setdefault("updated_at", _now_iso())
            data.setdefault("grants", [])
            return data
    except Exception:
        return None
    return None



def load_state() -> Dict[str, Any]:
    with _LOCK:
        grants = [dict(row) for row in list_docs(_NAMESPACE, db_path=_db_path()) if isinstance(row, dict)]
        if grants:
            return {
                "version": "cortex.reasoning.approvals.v1",
                "updated_at": _now_iso(),
                "grants": grants,
            }
        if not ENABLE_LEGACY_JSON_FALLBACK:
            return _default_state()
        legacy = _legacy_state()
        if legacy:
            save_state(legacy)
            return legacy
        return _default_state()



def save_state(state: Dict[str, Any]) -> Dict[str, Any]:
    grants = [dict(row) for row in (state.get("grants") or []) if isinstance(row, dict)]
    state["updated_at"] = _now_iso()
    with _LOCK:
        replace_namespace_docs(_NAMESPACE, grants, id_field="grant_id", db_path=_db_path())
    return state



def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None



def _normalize_grant(grant: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(grant or {})
    out.setdefault("grant_id", f"grant_{uuid4().hex[:12]}")
    out.setdefault("created_at", _now_iso())
    out.setdefault("granted_by", "human")
    out.setdefault("scope", "workflow")
    out.setdefault("workflow_id", None)
    out.setdefault("task_id", None)
    out.setdefault("node_ids", [])
    out.setdefault("endpoint_prefixes", [])
    out.setdefault("methods", [])
    out.setdefault("risk_levels", [])
    out.setdefault("expires_at", None)
    out.setdefault("revoked_at", None)
    out.setdefault("note", None)
    out.setdefault("metadata", {})
    out["node_ids"] = [str(x) for x in (out.get("node_ids") or []) if str(x).strip()]
    out["endpoint_prefixes"] = [str(x) for x in (out.get("endpoint_prefixes") or []) if str(x).strip()]
    out["methods"] = [str(x).upper() for x in (out.get("methods") or []) if str(x).strip()]
    out["risk_levels"] = [str(x).lower() for x in (out.get("risk_levels") or []) if str(x).strip()]
    out["metadata"] = dict(out.get("metadata") or {})
    return out



def create_approval_grant(**kwargs: Any) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        grants = state.setdefault("grants", [])
        grant = _normalize_grant(kwargs)
        grants.append(grant)
        if len(grants) > 1000:
            del grants[:-1000]
        save_state(state)
        return dict(grant)



def get_approval_grant(grant_id: str) -> Optional[Dict[str, Any]]:
    for row in load_state().get("grants") or []:
        if isinstance(row, dict) and str(row.get("grant_id") or "") == str(grant_id):
            return _normalize_grant(row)
    return None



def list_approval_grants(*, include_revoked: bool = False) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in load_state().get("grants") or []:
        if not isinstance(row, dict):
            continue
        grant = _normalize_grant(row)
        if not include_revoked and grant.get("revoked_at"):
            continue
        out.append(grant)
    return out



def revoke_approval_grant(grant_id: str) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        for row in state.get("grants") or []:
            if isinstance(row, dict) and str(row.get("grant_id") or "") == str(grant_id):
                row["revoked_at"] = _now_iso()
                save_state(state)
                return _normalize_grant(row)
    raise ReasoningApprovalError(f"unknown approval grant: {grant_id}")



def _is_active(grant: Dict[str, Any], *, now_iso: Optional[str] = None) -> bool:
    if grant.get("revoked_at"):
        return False
    now_dt = _parse_ts(now_iso) or datetime.now(timezone.utc)
    expires_at = _parse_ts(grant.get("expires_at"))
    if expires_at and expires_at <= now_dt:
        return False
    return True



def resolve_approval_grants(workflow_metadata: Optional[Dict[str, Any]] = None, step: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    workflow_metadata = dict(workflow_metadata or {})
    step = dict(step or {})
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()

    embedded = []
    embedded.extend(workflow_metadata.get("approval_grants") or [])
    step_metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    embedded.extend((step_metadata or {}).get("approval_grants") or [])
    for item in embedded:
        if isinstance(item, dict):
            grant = _normalize_grant(item)
            gid = str(grant.get("grant_id") or "")
            if gid and gid not in seen:
                seen.add(gid)
                out.append(grant)

    grant_ids: List[str] = []
    grant_ids.extend(str(x) for x in (workflow_metadata.get("approval_grant_ids") or []) if str(x).strip())
    grant_ids.extend(str(x) for x in ((step_metadata or {}).get("approval_grant_ids") or []) if str(x).strip())
    for grant_id in grant_ids:
        grant = get_approval_grant(grant_id)
        if grant and grant_id not in seen:
            seen.add(grant_id)
            out.append(grant)

    return out



def grant_allows_step(
    step: Dict[str, Any],
    *,
    workflow_metadata: Optional[Dict[str, Any]] = None,
    risk: Optional[str] = None,
    required_scope: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    workflow_metadata = dict(workflow_metadata or {})
    method = str(step.get("method") or "POST").upper()
    endpoint = str(step.get("endpoint") or "")
    node_id = str(step.get("node_id") or "")
    workflow_id = str(workflow_metadata.get("workflow_id") or "")
    task_id = str(workflow_metadata.get("task_id") or workflow_metadata.get("kernel_task_id") or "")
    risk_value = str(risk or "").lower().strip()

    for grant in resolve_approval_grants(workflow_metadata, step):
        if not _is_active(grant):
            continue
        if required_scope and str(grant.get("scope") or "") != str(required_scope):
            continue
        grant_workflow_id = str(grant.get("workflow_id") or "")
        if grant_workflow_id and workflow_id and grant_workflow_id != workflow_id:
            continue
        grant_task_id = str(grant.get("task_id") or "")
        if grant_task_id and task_id and grant_task_id != task_id:
            continue
        node_ids = [str(x) for x in (grant.get("node_ids") or []) if str(x).strip()]
        if node_ids and node_id not in node_ids:
            continue
        endpoint_prefixes = [str(x) for x in (grant.get("endpoint_prefixes") or []) if str(x).strip()]
        if endpoint_prefixes and not any(endpoint.startswith(prefix) for prefix in endpoint_prefixes):
            continue
        methods = [str(x).upper() for x in (grant.get("methods") or []) if str(x).strip()]
        if methods and method not in methods:
            continue
        risk_levels = [str(x).lower() for x in (grant.get("risk_levels") or []) if str(x).strip()]
        if risk_levels and risk_value and risk_value not in risk_levels:
            continue
        scope = str(grant.get("scope") or "workflow")
        if scope == "step" and not node_ids and not node_id:
            continue
        if scope == "endpoint" and not endpoint_prefixes:
            continue
        if scope == "risk_class" and risk_levels and risk_value and risk_value not in risk_levels:
            continue
        return grant
    return None


__all__ = [
    "ReasoningApprovalError",
    "create_approval_grant",
    "get_approval_grant",
    "grant_allows_step",
    "list_approval_grants",
    "load_state",
    "resolve_approval_grants",
    "revoke_approval_grant",
    "save_state",
]
