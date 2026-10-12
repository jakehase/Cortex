"""Level 23: The Cartographer - system mapping and topology.

Builds a measured map of Cortex:

* **Availability** per level comes from ``modules.level_probe`` (mounted
  routes, router load report, in-process status-handler probes).
* **Topology edges** come from a static scan of Cortex's own source: calls to
  ``internal_url("/<prefix>...")``, ``chain_to(..., "<prefix>/...")`` and
  cross-imports of level routers/modules. Edges are labelled with the kind of
  evidence and the source file, so nothing is asserted without a reference.
* **External dependencies** a level's code references (Chroma, OpenClaw lane,
  Redis/Celery, Piper/Wyoming, ffmpeg, Docker, Playwright, SQLite).

The scan reads only files inside the ``cortex_server`` package and writes
nothing.
"""

from __future__ import annotations

import os
import re
import socket
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cortex_server.internal_addressing import internal_host_port
from cortex_server.modules.health_status import UNTESTED
from cortex_server.modules.level_registry import get_level_registry

# Canonical LEVEL_MAP - derived from the shared registry to avoid count drift.
_REGISTRY = get_level_registry()
LEVEL_MAP = {int(row['level']): str(row['slug']) for row in _REGISTRY}

# Reverse mapping for name lookups
NAME_TO_LEVEL = {v: k for k, v in LEVEL_MAP.items()}
for _row in _REGISTRY:
    _root = str(_row['route_prefix']).strip('/').split('/')[0]
    if _root:
        NAME_TO_LEVEL[_root] = int(_row['level'])
    for _alias in _row.get('aliases', []):
        _alias_root = str(_alias).strip('/').split('/')[0]
        if _alias_root:
            NAME_TO_LEVEL[_alias_root] = int(_row['level'])

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
MAX_SOURCE_BYTES = 2_000_000

_INTERNAL_URL_RE = re.compile(r"internal_url\(\s*[fr]?[\"'](/[A-Za-z0-9_]+)")
_CHAIN_TO_RE = re.compile(r"chain_to\(\s*[\"'][^\"']*[\"']\s*,\s*[fr]?[\"']/?([A-Za-z0-9_]+)/")
_IMPORT_RE = re.compile(r"from\s+cortex_server\.(routers|modules)\.([A-Za-z0-9_]+)\s+import|from\s+cortex_server\.(routers|modules)\s+import\s+([A-Za-z0-9_, ]+)")

EXTERNAL_DEPENDENCY_MARKERS: Dict[str, Tuple[str, ...]] = {
    "chroma": ("chromadb", "Chroma("),
    "openclaw_lane": ("call_openclaw_local", "level_model_json", "level_model_call_sync"),
    "redis": ("import redis", "redis.Redis", "check_redis_connection"),
    "celery": ("celery_app", "from celery"),
    "piper_tts": ("Wyoming", "_wyoming_"),
    "ffmpeg": ("ffmpeg",),
    "docker": ("docker.from_env", "import docker"),
    "playwright": ("playwright",),
    "sqlite": ("sqlite3.connect",),
    "outbound_http": ("outbound_egress", "outbound_request("),
}

_scan_lock = threading.Lock()
_scan_cache: Optional[Dict[str, Any]] = None


def _prefix_to_level() -> Dict[str, int]:
    return {str(row["route_prefix"]).strip("/"): int(row["level"]) for row in _REGISTRY}


def _file_level(path: Path, prefix_levels: Dict[str, int]) -> Optional[int]:
    stem = path.stem
    if path.parent.name == "routers":
        try:
            from cortex_server.capability_manifest import CAPABILITY_BY_MODULE

            capability = CAPABILITY_BY_MODULE.get(stem)
            if capability is not None:
                level = prefix_levels.get(str(capability.prefix).strip("/"))
                if level is not None:
                    return level
        except Exception:
            pass
    return NAME_TO_LEVEL.get(stem) or prefix_levels.get(stem)


def _target_level(name: str, prefix_levels: Dict[str, int]) -> Optional[int]:
    return prefix_levels.get(name) or NAME_TO_LEVEL.get(name)


def scan_topology(*, refresh: bool = False) -> Dict[str, Any]:
    """Static level->level edges and external dependency references (cached)."""

    global _scan_cache
    with _scan_lock:
        if _scan_cache is not None and not refresh:
            return _scan_cache
        prefix_levels = _prefix_to_level()
        edges: Dict[Tuple[int, int, str], Dict[str, Any]] = {}
        dependencies: Dict[int, Dict[str, List[str]]] = {}
        files_scanned = 0
        for folder in ("routers", "modules"):
            directory = PACKAGE_ROOT / folder
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.py")):
                if path.name.startswith("_") or path.is_symlink():
                    continue
                source_level = _file_level(path, prefix_levels)
                if source_level is None:
                    continue
                try:
                    if path.stat().st_size > MAX_SOURCE_BYTES:
                        continue
                    text = path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                files_scanned += 1
                rel = f"{folder}/{path.name}"
                targets: List[Tuple[int, str]] = []
                for match in _INTERNAL_URL_RE.finditer(text):
                    level = _target_level(match.group(1).strip("/"), prefix_levels)
                    if level is not None:
                        targets.append((level, "internal_http"))
                for match in _CHAIN_TO_RE.finditer(text):
                    level = _target_level(match.group(1), prefix_levels)
                    if level is not None:
                        targets.append((level, "chain_to_http"))
                for match in _IMPORT_RE.finditer(text):
                    names = [match.group(2)] if match.group(2) else [
                        part.strip().split(" as ")[0] for part in (match.group(4) or "").split(",")
                    ]
                    for name in names:
                        level = _target_level(name, prefix_levels)
                        if level is not None:
                            targets.append((level, "in_process_import"))
                for target, kind in targets:
                    if target == source_level:
                        continue
                    key = (source_level, target, kind)
                    row = edges.setdefault(key, {"from": source_level, "to": target, "kind": kind, "evidence": []})
                    if rel not in row["evidence"] and len(row["evidence"]) < 5:
                        row["evidence"].append(rel)
                for dep, markers in EXTERNAL_DEPENDENCY_MARKERS.items():
                    if any(marker in text for marker in markers):
                        files = dependencies.setdefault(source_level, {}).setdefault(dep, [])
                        if rel not in files and len(files) < 5:
                            files.append(rel)
        _scan_cache = {
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "files_scanned": files_scanned,
            "edges": sorted(edges.values(), key=lambda e: (e["from"], e["to"], e["kind"])),
            "dependencies": {str(level): deps for level, deps in sorted(dependencies.items())},
            "method": "static_source_scan",
        }
        return _scan_cache


def build_topology(probe_snapshot: Optional[Dict[str, Any]] = None, mount_states: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Nodes (levels + external deps) with availability, plus evidenced edges."""

    scan = scan_topology()
    status_by_level: Dict[int, Dict[str, Any]] = {}
    for row in (probe_snapshot or {}).get("levels") or mount_states or ():
        status_by_level[int(row["level"])] = row
    nodes: List[Dict[str, Any]] = []
    for row in _REGISTRY:
        level = int(row["level"])
        observed = status_by_level.get(level, {})
        nodes.append(
            {
                "id": f"L{level}",
                "kind": "level",
                "level": level,
                "name": row["name"],
                "status": observed.get("status", UNTESTED),
                "mount": observed.get("mount"),
                "probe_outcome": (observed.get("probe") or {}).get("outcome"),
            }
        )
    dep_names = sorted({dep for deps in scan["dependencies"].values() for dep in deps})
    for dep in dep_names:
        nodes.append({"id": f"dep:{dep}", "kind": "external_dependency", "name": dep, "status": "not_probed"})
    edges = [
        {"source": f"L{edge['from']}", "target": f"L{edge['to']}", "kind": edge["kind"], "evidence": edge["evidence"]}
        for edge in scan["edges"]
    ]
    for level, deps in scan["dependencies"].items():
        for dep, files in deps.items():
            edges.append({"source": f"L{level}", "target": f"dep:{dep}", "kind": "references_dependency", "evidence": files})
    return {
        "nodes": nodes,
        "edges": edges,
        "edge_method": scan["method"],
        "files_scanned": scan["files_scanned"],
        "scanned_at": scan["scanned_at"],
    }


class Cartographer:
    '''Level 23: The Cartographer - Self-Discovery Module (measured, read-only).'''

    def __init__(self):
        self.modules_dir = PACKAGE_ROOT / 'modules'

    def scan_cortex(self):
        '''List module files under the package and the level each maps to.'''
        skills = []
        if not self.modules_dir.is_dir():
            return skills
        for py_file in sorted(self.modules_dir.glob('*.py')):
            if py_file.name.startswith('__'):
                continue
            skills.append({
                'name': py_file.stem,
                'file': str(py_file.relative_to(PACKAGE_ROOT)),
                'level': NAME_TO_LEVEL.get(py_file.stem),
            })
        return skills

    def check_pulse(self):
        '''TCP reachability of the Cortex origin and the configured Piper port.'''
        cortex_host, cortex_port = internal_host_port()
        services = {
            'cortex': {'port': cortex_port, 'status': 'unknown', 'host': cortex_host},
            'piper_tts': {
                'port': int(os.getenv('CORTEX_BARD_PIPER_PORT', '10200') or 10200),
                'status': 'unknown',
                'host': os.getenv('CORTEX_BARD_PIPER_HOST', '127.0.0.1'),
            },
        }
        for name, config in services.items():
            try:
                with socket.create_connection((config['host'], config['port']), timeout=2):
                    services[name]['status'] = 'tcp_open'
            except OSError as exc:
                services[name]['status'] = f'down:{type(exc).__name__}'
        return services

    def update_identity(self):
        '''Return a measured identity map (nothing is written to disk).'''
        from cortex_server.modules.kernel import kernel_level_status

        levels = kernel_level_status()
        return {
            'name': 'The Cortex',
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'designation': 'Level 23: The Cartographer',
            'modules': self.scan_cortex(),
            'services': self.check_pulse(),
            'level_availability': {
                'measured': levels.get('measured'),
                'counts': levels.get('counts'),
            },
            'total_levels': len(LEVEL_MAP),
            'level_map': LEVEL_MAP,
        }

    def get_all_levels(self):
        '''Return all registered levels'''
        return LEVEL_MAP

    def get_level_name(self, level_num):
        '''Get level name by number'''
        return LEVEL_MAP.get(level_num, 'unknown')

    def get_level_number(self, level_name):
        '''Get level number by name'''
        return NAME_TO_LEVEL.get(level_name, 0)
