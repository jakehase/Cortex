"""Explicit production capability manifest for Cortex API routers.

Router files are deliberately enumerated here.  A new file cannot become a
production API merely by exporting an ``APIRouter``; the manifest invariant in
``main.load_dynamic_routers`` rejects undeclared files instead.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RouterCapability:
    module: str
    prefix: str
    tag: str
    safety_class: str
    kind: str = "http"
    production: bool = True


def _cap(
    module: str,
    tag: str | None = None,
    *,
    kind: str = "http",
    safety_class: str,
    production: bool = True,
) -> RouterCapability:
    return RouterCapability(
        module=module,
        prefix="" if kind == "websocket" else f"/{module}",
        tag=tag or module.replace("_", " ").title(),
        kind=kind,
        safety_class=safety_class,
        production=production,
    )


def _service(
    module: str,
    tag: str | None = None,
    *,
    kind: str = "http",
) -> RouterCapability:
    """Declare an inert/read-orchestrating production capability explicitly."""
    return _cap(module, tag, kind=kind, safety_class="service")


def _unsafe(module: str, tag: str | None = None) -> RouterCapability:
    """Declare a router that can mutate the host, devices, or external systems."""
    return _cap(module, tag, safety_class="unsafe_action")


def _test_only(module: str, tag: str | None = None) -> RouterCapability:
    return _cap(
        module,
        tag,
        safety_class="test_only",
        production=False,
    )


# ``unsafe_action`` routers expose host, network, device, or arbitrary action
# primitives.  Safe mode is a load-time allowlist: these capabilities do not
# enter the ASGI routing table at all unless safe mode is explicitly disabled.
ROUTER_CAPABILITIES: tuple[RouterCapability, ...] = (
    _service("academy"),
    _unsafe("architect"),
    _service("augmenter"),
    _service("automation"),
    _service("autonomy"),
    _service("autonomy_governor", "Autonomy Governor"),
    _service("awareness"),
    _service("bard"),
    _service("bridge"),
    _unsafe("browser", "Browser"),
    _service("catalyst"),
    _service("chronos"),
    _service("command_center", "Command Center"),
    _service("command_center_live", "Command Center Live"),
    _service("conductor"),
    _service("contract"),
    _service("council"),
    _service("cron"),
    _unsafe("darwin"),
    _unsafe("diplomat"),
    _service("dreamer"),
    _service("ethicist"),
    _service("everyday_intel", "Everyday Intel"),
    _unsafe("evolution"),
    _service("fallback"),
    _unsafe("forge"),
    _unsafe("geneticist"),
    _service("ghost"),
    _service("guard"),
    _service("hive"),
    _unsafe("homeassistant", "HomeAssistant"),
    _service("hud_display", "HUD Display"),
    _test_only("inbox_test", "Inbox Test"),
    _service("kernel"),
    _service("knowledge"),
    _service("l22", "L22"),
    _unsafe("lab"),
    _service("librarian"),
    _service("listener"),
    _service("mediator"),
    _service("meta_conductor", "Meta Conductor"),
    _service("mirror"),
    _service("mission_control", "Mission Control"),
    _service("muse"),
    _service("nexus"),
    _service("night_shift", "Night Shift"),
    _unsafe("openclaw", "OpenClaw"),
    _service("oracle"),
    _service("oracle_sandbox", "Oracle Sandbox"),
    _service("orchestrator"),
    _unsafe("parsers"),
    _service("polyglot"),
    _service("queue"),
    _service("seer"),
    _service("sentinel"),
    _service("simulator"),
    _service("singularity"),
    _service("synthesist_api", "Synthesist"),
    _service("system", "System Attestation"),
    _unsafe("tools"),
    _service("validator"),
    _service("websockets", "WebSockets", kind="websocket"),
)


CAPABILITY_BY_MODULE = {row.module: row for row in ROUTER_CAPABILITIES}
UNSAFE_ACTION_MODULES = frozenset(
    row.module for row in ROUTER_CAPABILITIES if row.safety_class == "unsafe_action"
)

if len(CAPABILITY_BY_MODULE) != len(ROUTER_CAPABILITIES):  # pragma: no cover - import invariant
    raise RuntimeError("duplicate router module in capability manifest")

if any(row.kind not in {"http", "websocket"} for row in ROUTER_CAPABILITIES):  # pragma: no cover
    raise RuntimeError("invalid capability kind in router manifest")
