from __future__ import annotations

import os
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Set

JsonDict = Dict[str, Any]

_LOCK = threading.Lock()
_WARNINGS: Deque[JsonDict] = deque(maxlen=120)
_STATE: JsonDict = {
    "embedding_calls": 0,
    "onnx_session_inits": 0,
    "onnx_sessions_with_explicit_threads": 0,
    "onnx_sessions_without_explicit_threads": 0,
    "last_embedding_call_at": "",
    "last_session_init_at": "",
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _env_value(*names: str) -> Optional[str]:
    for name in names:
        raw = os.getenv(name)
        if raw is not None:
            return raw
    return None


def _env_bool(*names: str, default: bool) -> bool:
    raw = _env_value(*names)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(*names: str, default: int, minimum: int, maximum: int) -> int:
    raw = _env_value(*names)
    if raw is None:
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return max(minimum, min(maximum, value))


def _cpu_allowed_list() -> str:
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("Cpus_allowed_list"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        return ""
    return ""


def _expand_cpu_ranges(spec: str) -> Set[int]:
    cpus: Set[int] = set()
    for part in (spec or "").split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_text, end_text = token.split("-", 1)
            try:
                start = int(start_text)
                end = int(end_text)
            except Exception:
                continue
            if start > end:
                start, end = end, start
            cpus.update(range(start, end + 1))
            continue
        try:
            cpus.add(int(token))
        except Exception:
            continue
    return cpus


def _preferred_providers() -> List[str]:
    raw = _env_value("CORTEX_LIBRARIAN_ONNX_PROVIDERS", "CORTEX_ONNX_PROVIDERS")
    if raw:
        values = [item.strip() for item in raw.split(",") if item.strip()]
        if values:
            return values
    return ["CPUExecutionProvider"]


def configured_embedding_mode() -> str:
    mode = str(_env_value("CORTEX_LIBRARIAN_EMBEDDING_MODE") or "persistent").strip().lower() or "persistent"
    if mode not in {"persistent", "default"}:
        return "persistent"
    return mode


def configured_benchmark_mode() -> bool:
    return _env_bool("CORTEX_RUNTIME_BENCHMARK_MODE", default=False)


def recommended_intra_op_threads() -> int:
    allowed = len(_expand_cpu_ranges(_cpu_allowed_list()))
    visible = int(os.cpu_count() or 1)
    usable = max(1, allowed or visible)
    if usable <= 2:
        return 1
    return min(2, usable)


def configured_explicit_threads() -> bool:
    return _env_bool("CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS", default=True)


def configured_intra_op_threads() -> int:
    return _env_int(
        "CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS",
        "CORTEX_ONNX_INTRA_OP_THREADS",
        default=recommended_intra_op_threads(),
        minimum=1,
        maximum=max(1, int(os.cpu_count() or 1)),
    )


def configured_inter_op_threads() -> int:
    return _env_int(
        "CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS",
        "CORTEX_ONNX_INTER_OP_THREADS",
        default=1,
        minimum=1,
        maximum=max(1, int(os.cpu_count() or 1)),
    )


def configured_allow_spinning() -> bool:
    return _env_bool("CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING", "CORTEX_ONNX_ALLOW_SPINNING", default=False)


def host_environment() -> JsonDict:
    allowed_list = _cpu_allowed_list()
    allowed = sorted(_expand_cpu_ranges(allowed_list))
    zero_based_contiguous = allowed == list(range(len(allowed))) if allowed else True
    return {
        "pid": os.getpid(),
        "cpu_count": int(os.cpu_count() or 0),
        "cpus_allowed_list": allowed_list,
        "allowed_cpus": allowed,
        "allowed_cpu_count": len(allowed),
        "lowest_allowed_cpu": allowed[0] if allowed else None,
        "highest_allowed_cpu": allowed[-1] if allowed else None,
        "zero_based_contiguous": zero_based_contiguous,
        "affinity_layout_risk": not zero_based_contiguous,
    }


def runtime_configuration() -> JsonDict:
    explicit = configured_explicit_threads()
    return {
        "embedding_mode": configured_embedding_mode(),
        "benchmark_mode": configured_benchmark_mode(),
        "preferred_providers": _preferred_providers(),
        "explicit_threads": explicit,
        "recommended_intra_op_threads": recommended_intra_op_threads(),
        "configured_intra_op_threads": configured_intra_op_threads() if explicit else None,
        "configured_inter_op_threads": configured_inter_op_threads() if explicit else None,
        "allow_spinning": configured_allow_spinning() if explicit else None,
    }


def record_warning(*, kind: str, source: str, detail: Optional[str] = None, extra: Optional[JsonDict] = None) -> None:
    row = {
        "ts": _utcnow_iso(),
        "kind": str(kind or "runtime_warning"),
        "source": str(source or "runtime"),
        "detail": str(detail or "")[:320],
        "extra": dict(extra or {}),
    }
    with _LOCK:
        _WARNINGS.append(row)


def record_embedding_call(*, source: str) -> None:
    with _LOCK:
        _STATE["embedding_calls"] = int(_STATE.get("embedding_calls") or 0) + 1
        _STATE["last_embedding_call_at"] = _utcnow_iso()


def record_onnx_session_init(
    *,
    source: str,
    explicit_threads: bool,
    intra_op_threads: Optional[int],
    inter_op_threads: Optional[int],
    providers: Optional[List[str]] = None,
) -> None:
    host = host_environment()
    with _LOCK:
        _STATE["onnx_session_inits"] = int(_STATE.get("onnx_session_inits") or 0) + 1
        _STATE["last_session_init_at"] = _utcnow_iso()
        key = "onnx_sessions_with_explicit_threads" if explicit_threads else "onnx_sessions_without_explicit_threads"
        _STATE[key] = int(_STATE.get(key) or 0) + 1
    if host.get("affinity_layout_risk") and not explicit_threads:
        record_warning(
            kind="onnx_affinity_risk",
            source=source,
            detail="ONNX session initialized without explicit thread counts on a non-zero-based / non-contiguous CPU set.",
            extra={
                "cpus_allowed_list": host.get("cpus_allowed_list"),
                "providers": list(providers or []),
                "intra_op_threads": intra_op_threads,
                "inter_op_threads": inter_op_threads,
            },
        )


def pressure_snapshot() -> JsonDict:
    host = host_environment()
    runtime = runtime_configuration()
    with _LOCK:
        state = dict(_STATE)
        warnings = list(_WARNINGS)
    degraded_reason = ""
    if int(state.get("onnx_sessions_without_explicit_threads") or 0) > 0 and bool(host.get("affinity_layout_risk")):
        degraded_reason = "onnx_affinity_risk_without_explicit_threads"
    elif len(warnings) >= 5:
        degraded_reason = "warning_spike"
    level = "degraded" if degraded_reason else ("warning" if warnings else "normal")
    return {
        "status": {
            "level": level,
            "degraded": bool(degraded_reason),
            "reason": degraded_reason or None,
        },
        "host": host,
        "runtime": runtime,
        "counters": {
            "embedding_calls": int(state.get("embedding_calls") or 0),
            "onnx_session_inits": int(state.get("onnx_session_inits") or 0),
            "onnx_sessions_with_explicit_threads": int(state.get("onnx_sessions_with_explicit_threads") or 0),
            "onnx_sessions_without_explicit_threads": int(state.get("onnx_sessions_without_explicit_threads") or 0),
            "warning_count": len(warnings),
        },
        "warnings": {
            "count": len(warnings),
            "recent": warnings[-10:],
        },
        "latest": {
            "embedding_call_at": state.get("last_embedding_call_at") or None,
            "session_init_at": state.get("last_session_init_at") or None,
        },
    }


def benchmark_environment_metadata() -> JsonDict:
    snapshot = pressure_snapshot()
    return {
        "host": snapshot.get("host"),
        "runtime": snapshot.get("runtime"),
        "pressure": snapshot.get("status"),
    }


def reset_state() -> None:
    with _LOCK:
        _WARNINGS.clear()
        _STATE.clear()
        _STATE.update(
            {
                "embedding_calls": 0,
                "onnx_session_inits": 0,
                "onnx_sessions_with_explicit_threads": 0,
                "onnx_sessions_without_explicit_threads": 0,
                "last_embedding_call_at": "",
                "last_session_init_at": "",
            }
        )
