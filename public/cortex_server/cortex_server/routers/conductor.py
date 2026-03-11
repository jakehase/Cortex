"""Compatibility shim: /conductor/* routes to L26 Orchestrator.

The real implementation lives in orchestrator.py. We keep this file so
existing clients don’t break.
"""

from cortex_server.routers.orchestrator import router  # noqa: F401
