"""Shared authentication helpers for tenant-scoped Cortex memory calls."""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import Dict, Optional


MEMORY_SCOPE_VERSION = "cortex.memory.scope.v1"


def default_tenant_id() -> str:
    return os.getenv("CORTEX_DEFAULT_TENANT_ID", "cortex-local").strip() or "cortex-local"


def default_workspace_id() -> str:
    return os.getenv("CORTEX_DEFAULT_WORKSPACE_ID", "default").strip() or "default"


def memory_scope_signature(
    tenant_id: str,
    workspace_id: str,
    *,
    secret: Optional[str] = None,
) -> str:
    signing_secret = str(secret if secret is not None else os.getenv("CORTEX_MEMORY_SCOPE_SECRET", "")).strip()
    if not signing_secret:
        return ""
    message = f"{MEMORY_SCOPE_VERSION}\n{tenant_id}\n{workspace_id}".encode("utf-8")
    return hmac.new(signing_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def authenticated_memory_scope_fields(
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> Dict[str, str]:
    """Return the canonical body fields used by Librarian/L22/Knowledge APIs."""

    tenant = str(tenant_id or default_tenant_id()).strip()
    workspace = str(workspace_id or default_workspace_id()).strip()
    fields = {"tenant_id": tenant, "workspace_id": workspace}
    signature = memory_scope_signature(tenant, workspace)
    if signature:
        fields["scope_signature"] = signature
    return fields
