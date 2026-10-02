#!/usr/bin/env python3
"""
The Cortex Server Startup Script
"""

import sys
import os
import ipaddress

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cortex_server.internal_addressing import DEFAULT_CORTEX_HOST, DEFAULT_CORTEX_PORT
import uvicorn


def _truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _loopback_host(host):
    if str(host).strip().lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(str(host).strip()).is_loopback
    except ValueError:
        return False


def launch_config(environ=None):
    """Resolve the alternate launcher with secure local defaults."""
    env = os.environ if environ is None else environ
    host = str(env.get("CORTEX_HOST", DEFAULT_CORTEX_HOST)).strip()
    try:
        port = int(env.get("CORTEX_PORT", str(DEFAULT_CORTEX_PORT)))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("CORTEX_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError("CORTEX_PORT must be between 1 and 65535")
    reload_enabled = _truthy(env.get("CORTEX_RELOAD", "false"))
    if not _loopback_host(host):
        auth_mode = str(env.get("CORTEX_WRITE_AUTH_MODE", "token_or_loopback")).strip().lower()
        token = str(env.get("CORTEX_WRITE_TOKEN", "")).strip()
        if auth_mode != "token_required" or len(token.encode("utf-8")) < 32:
            raise RuntimeError(
                "non-loopback alternate launcher bind requires token_required mode "
                "and a dedicated 32-byte write token"
            )
        if reload_enabled:
            raise RuntimeError("reload is not allowed on a non-loopback bind")
    return {"host": host, "port": port, "reload": reload_enabled}

if __name__ == "__main__":
    config = launch_config()
    uvicorn.run(
        "cortex_server.main:app",
        **config,
        log_level="info",
        ws_max_size=4096,
    )
