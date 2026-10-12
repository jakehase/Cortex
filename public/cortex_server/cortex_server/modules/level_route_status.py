"""Derive a level's advertised capabilities from the routes that are mounted.

Several level status endpoints used to return a hard-coded capability list
that named routes which safe mode never mounts.  This helper reads the live
ASGI routing table so a status endpoint can only claim what a caller can
actually reach, and labels everything else with the reason it is unavailable.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Set, Tuple


RouteKey = Tuple[str, str]


def mounted_routes(request: Any, prefix: str) -> Set[RouteKey]:
    """Return ``{(METHOD, path)}`` for every mounted route under ``prefix``.

    ``path`` is relative to the prefix (``/status`` for ``/parsers/status``).
    Returns an empty set when the request has no app (unit tests that call a
    handler directly); callers then report ``mounted: unknown`` honestly.
    """

    app = getattr(request, "app", None)
    routes = getattr(app, "routes", None) if app is not None else None
    if routes is None:
        return set()
    base = "/" + str(prefix or "").strip("/")
    found: Set[RouteKey] = set()
    stack: List[Any] = list(routes)
    while stack:
        route = stack.pop()
        nested = getattr(route, "routes", None)
        if nested and not getattr(route, "methods", None):
            stack.extend(nested)
            continue
        path = str(getattr(route, "path", "") or "")
        if not (path == base or path.startswith(base + "/")):
            continue
        relative = path[len(base):] or "/"
        for method in getattr(route, "methods", None) or ():
            method = str(method).upper()
            if method in {"HEAD", "OPTIONS"}:
                continue
            found.add((method, relative))
    return found


def capability_report(
    request: Any,
    prefix: str,
    capabilities: Mapping[str, Iterable[RouteKey]],
    *,
    extra_unavailable: Optional[Mapping[str, str]] = None,
) -> Dict[str, Any]:
    """Split named capabilities into available / unavailable by mounting.

    ``capabilities`` maps a capability name to the route(s) it needs; it is
    available only when every one of those routes is mounted.  When the live
    routing table cannot be read the result says so instead of guessing.
    """

    mounted = mounted_routes(request, prefix)
    known = bool(mounted) or getattr(getattr(request, "app", None), "routes", None) is not None
    available: List[str] = []
    unavailable: List[Dict[str, str]] = []
    blocked = dict(extra_unavailable or {})
    for name, needed in capabilities.items():
        needed_set = {(str(m).upper(), str(p)) for m, p in needed}
        if name in blocked:
            unavailable.append({"capability": name, "reason": blocked[name]})
        elif not known:
            unavailable.append({"capability": name, "reason": "routing_table_unavailable"})
        elif needed_set <= mounted:
            available.append(name)
        else:
            unavailable.append({"capability": name, "reason": "route_not_mounted"})
    return {
        "capabilities": available,
        "unavailable": unavailable,
        "mounted_routes": sorted(f"{m} {prefix.rstrip('/')}{p}" for m, p in mounted),
        "routing_table_observed": known,
    }
