from __future__ import annotations

import json
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
SQLITE_TIMEOUT_SECONDS = float(os.getenv("REASONING_STORE_SQLITE_TIMEOUT_SECONDS", "2.5"))
SQLITE_BUSY_TIMEOUT_MS = int(os.getenv("REASONING_STORE_SQLITE_BUSY_TIMEOUT_MS", "2500"))
AUTO_BACKUP_ENABLED = str(os.getenv("REASONING_STORE_AUTO_BACKUP_ENABLED", "1")).strip().lower() not in {"0", "false", "no", "off"}
AUTO_BACKUP_MIN_INTERVAL_SECONDS = float(os.getenv("REASONING_STORE_AUTO_BACKUP_MIN_INTERVAL_SECONDS", "300"))
MAX_BACKUP_FILES = int(os.getenv("REASONING_STORE_MAX_BACKUP_FILES", "5"))



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _db_path(db_path: Optional[Path | str] = None) -> Path:
    return Path(str(db_path or DEFAULT_DB_PATH))



def _backup_dir(path: Path) -> Path:
    return path.parent / "backups"



def _backup_suffix() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")



def _connect(db_path: Optional[Path | str] = None, *, allow_recover: bool = True) -> sqlite3.Connection:
    path = _db_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = sqlite3.connect(str(path), timeout=SQLITE_TIMEOUT_SECONDS)
        conn.row_factory = sqlite3.Row
        conn.execute(f"PRAGMA busy_timeout={max(0, SQLITE_BUSY_TIMEOUT_MS)}")
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower():
                raise
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reasoning_documents (
                namespace TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY(namespace, doc_id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reasoning_documents_ns_updated ON reasoning_documents(namespace, updated_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reasoning_events (
                namespace TEXT NOT NULL,
                parent_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY(namespace, event_id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reasoning_events_ns_parent_created ON reasoning_events(namespace, parent_id, created_at)")
        return conn
    except sqlite3.DatabaseError as exc:
        if conn is not None:
            conn.close()
        if allow_recover and _should_recover_on_exception(exc):
            _recover_database_files(path)
            restore_latest_backup(path)
            return _connect(path, allow_recover=False)
        raise



def _serialize(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=False)



def _deserialize(blob: str) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(blob)
    except Exception:
        return None
    return data if isinstance(data, dict) else None



def _should_recover_on_exception(exc: BaseException) -> bool:
    message = str(exc or "").lower()
    return any(token in message for token in ("not a database", "malformed", "file is encrypted", "disk image is malformed"))



def _quarantine_file(path: Path) -> Optional[Path]:
    if not path.exists():
        return None
    target = Path(f"{path}.{_backup_suffix()}.corrupt")
    path.rename(target)
    return target



def _remove_database_files(path: Path) -> None:
    for candidate in [path, Path(f"{path}-wal"), Path(f"{path}-shm")]:
        if candidate.exists():
            candidate.unlink()



def _recover_database_files(path: Path) -> None:
    _quarantine_file(path)
    for suffix in ("-wal", "-shm"):
        _quarantine_file(Path(f"{path}{suffix}"))



def list_backups(db_path: Optional[Path | str] = None) -> List[Path]:
    path = _db_path(db_path)
    backup_dir = _backup_dir(path)
    if not backup_dir.exists():
        return []
    return sorted(backup_dir.glob(f"{path.name}.*.sqlite3"))



def _prune_backups(path: Path) -> None:
    if MAX_BACKUP_FILES <= 0:
        return
    backups = list_backups(path)
    if len(backups) <= MAX_BACKUP_FILES:
        return
    for old in backups[:-MAX_BACKUP_FILES]:
        if old.exists():
            old.unlink()



def create_backup(db_path: Optional[Path | str] = None, *, reason: str = "manual") -> Optional[Path]:
    path = _db_path(db_path)
    if not path.exists():
        return None
    backup_dir = _backup_dir(path)
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"{path.name}.{_backup_suffix()}.{reason}.sqlite3"
    src: Optional[sqlite3.Connection] = None
    dst: Optional[sqlite3.Connection] = None
    try:
        src = sqlite3.connect(str(path), timeout=SQLITE_TIMEOUT_SECONDS)
        dst = sqlite3.connect(str(target))
        src.backup(dst)
    except sqlite3.DatabaseError:
        if target.exists():
            target.unlink()
        return None
    finally:
        if dst is not None:
            dst.close()
        if src is not None:
            src.close()
    _prune_backups(path)
    return target



def restore_latest_backup(db_path: Optional[Path | str] = None) -> Optional[Path]:
    path = _db_path(db_path)
    backups = list_backups(path)
    if not backups:
        return None
    latest = backups[-1]
    path.parent.mkdir(parents=True, exist_ok=True)
    _remove_database_files(path)
    shutil.copy2(latest, path)
    return latest



def _maybe_auto_backup(db_path: Optional[Path | str] = None) -> Optional[Path]:
    path = _db_path(db_path)
    if not AUTO_BACKUP_ENABLED or AUTO_BACKUP_MIN_INTERVAL_SECONDS < 0 or not path.exists():
        return None
    backups = list_backups(path)
    if backups:
        age_seconds = max(0.0, datetime.now(timezone.utc).timestamp() - backups[-1].stat().st_mtime)
        if age_seconds < AUTO_BACKUP_MIN_INTERVAL_SECONDS:
            return None
    return create_backup(path, reason="auto")



def upsert_doc(namespace: str, doc_id: str, payload: Dict[str, Any], *, db_path: Optional[Path | str] = None) -> Dict[str, Any]:
    row = dict(payload or {})
    now = _now_iso()
    row.setdefault("created_at", now)
    row["updated_at"] = now
    with _connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO reasoning_documents(namespace, doc_id, created_at, updated_at, payload)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(namespace, doc_id) DO UPDATE SET
                updated_at=excluded.updated_at,
                payload=excluded.payload
            """,
            (namespace, str(doc_id), str(row.get("created_at") or now), str(row.get("updated_at") or now), _serialize(row)),
        )
    _maybe_auto_backup(db_path)
    return row



def get_doc(namespace: str, doc_id: str, *, db_path: Optional[Path | str] = None) -> Optional[Dict[str, Any]]:
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT payload FROM reasoning_documents WHERE namespace = ? AND doc_id = ?",
            (namespace, str(doc_id)),
        ).fetchone()
    if not row:
        return None
    data = _deserialize(str(row["payload"]))
    return dict(data) if isinstance(data, dict) else None



def list_docs(namespace: str, *, db_path: Optional[Path | str] = None) -> List[Dict[str, Any]]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT payload FROM reasoning_documents WHERE namespace = ? ORDER BY updated_at ASC, created_at ASC, doc_id ASC",
            (namespace,),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for row in rows:
        data = _deserialize(str(row["payload"]))
        if isinstance(data, dict):
            out.append(dict(data))
    return out



def replace_namespace_docs(namespace: str, docs: List[Dict[str, Any]], *, id_field: str, db_path: Optional[Path | str] = None) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    keep_ids: List[str] = []
    now = _now_iso()
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        row = dict(doc)
        doc_id = str(row.get(id_field) or "").strip()
        if not doc_id:
            continue
        row.setdefault("created_at", now)
        row["updated_at"] = now
        normalized.append(row)
        keep_ids.append(doc_id)
    with _connect(db_path) as conn:
        if keep_ids:
            placeholders = ",".join("?" for _ in keep_ids)
            conn.execute(
                f"DELETE FROM reasoning_documents WHERE namespace = ? AND doc_id NOT IN ({placeholders})",
                [namespace, *keep_ids],
            )
        else:
            conn.execute("DELETE FROM reasoning_documents WHERE namespace = ?", (namespace,))
        for row in normalized:
            conn.execute(
                """
                INSERT INTO reasoning_documents(namespace, doc_id, created_at, updated_at, payload)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(namespace, doc_id) DO UPDATE SET
                    updated_at=excluded.updated_at,
                    payload=excluded.payload
                """,
                (
                    namespace,
                    str(row.get(id_field)),
                    str(row.get("created_at") or now),
                    str(row.get("updated_at") or now),
                    _serialize(row),
                ),
            )
    _maybe_auto_backup(db_path)
    return normalized



def append_event(namespace: str, parent_id: str, event_id: str, payload: Dict[str, Any], *, db_path: Optional[Path | str] = None) -> Dict[str, Any]:
    row = dict(payload or {})
    now = _now_iso()
    row.setdefault("event_id", event_id)
    row.setdefault("process_id", parent_id)
    row.setdefault("created_at", row.get("ts") or now)
    row["updated_at"] = now
    with _connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO reasoning_events(namespace, parent_id, event_id, created_at, updated_at, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(namespace, event_id) DO UPDATE SET
                updated_at=excluded.updated_at,
                payload=excluded.payload
            """,
            (namespace, str(parent_id), str(event_id), str(row.get("created_at") or now), now, _serialize(row)),
        )
    _maybe_auto_backup(db_path)
    return row



def list_events(namespace: str, *, parent_id: Optional[str] = None, limit: Optional[int] = None, db_path: Optional[Path | str] = None) -> List[Dict[str, Any]]:
    sql = "SELECT payload FROM reasoning_events WHERE namespace = ?"
    params: List[Any] = [namespace]
    if parent_id is not None:
        sql += " AND parent_id = ?"
        params.append(str(parent_id))
    sql += " ORDER BY created_at ASC, event_id ASC"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(max(0, int(limit)))
    with _connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    out: List[Dict[str, Any]] = []
    for row in rows:
        data = _deserialize(str(row["payload"]))
        if isinstance(data, dict):
            out.append(dict(data))
    return out



def replace_namespace_events(namespace: str, events: List[Dict[str, Any]], *, parent_field: str, id_field: str, db_path: Optional[Path | str] = None) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    now = _now_iso()
    for event in events or []:
        if not isinstance(event, dict):
            continue
        row = dict(event)
        event_id = str(row.get(id_field) or "").strip()
        parent_id = str(row.get(parent_field) or "").strip()
        if not event_id or not parent_id:
            continue
        row.setdefault("created_at", row.get("ts") or now)
        row["updated_at"] = now
        normalized.append(row)
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM reasoning_events WHERE namespace = ?", (namespace,))
        for row in normalized:
            conn.execute(
                "INSERT INTO reasoning_events(namespace, parent_id, event_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    namespace,
                    str(row.get(parent_field)),
                    str(row.get(id_field)),
                    str(row.get("created_at") or now),
                    str(row.get("updated_at") or now),
                    _serialize(row),
                ),
            )
    _maybe_auto_backup(db_path)
    return normalized


__all__ = [
    "AUTO_BACKUP_ENABLED",
    "AUTO_BACKUP_MIN_INTERVAL_SECONDS",
    "DEFAULT_DB_PATH",
    "MAX_BACKUP_FILES",
    "SQLITE_BUSY_TIMEOUT_MS",
    "SQLITE_TIMEOUT_SECONDS",
    "append_event",
    "create_backup",
    "get_doc",
    "list_backups",
    "list_docs",
    "list_events",
    "replace_namespace_docs",
    "replace_namespace_events",
    "restore_latest_backup",
    "upsert_doc",
]
