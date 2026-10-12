"""Cross-version expansion of concrete FastAPI/Starlette routes."""

from __future__ import annotations

from typing import Iterable, Iterator, Any


def iter_effective_routes(routes: Iterable[Any]) -> Iterator[Any]:
    """Yield concrete routes from eager and lazy FastAPI router containers."""

    for route in routes:
        effective_candidates = getattr(route, "effective_candidates", None)
        if callable(effective_candidates):
            yield from iter_effective_routes(effective_candidates())
            continue
        effective_contexts = getattr(route, "effective_route_contexts", None)
        if callable(effective_contexts):
            yield from iter_effective_routes(effective_contexts())
            continue
        yield getattr(route, "starlette_route", None) or route
