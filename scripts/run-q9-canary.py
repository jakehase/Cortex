#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import shlex
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PRINCIPAL_HEADERS = {
    "tenant_id": "X-Cortex-Tenant-Id",
    "workspace_id": "X-Cortex-Workspace-Id",
    "agent_id": "X-Cortex-Agent-Id",
    "user_id": "X-Cortex-User-Id",
    "channel_id": "X-Cortex-Channel-Id",
    "session_id": "X-Cortex-Session-Id",
}


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise RuntimeError("invalid environment assignment")
        key, value = line.split("=", 1)
        parsed = shlex.split(value, posix=True)
        values[key.strip()] = "" if not parsed else parsed[0]
    return values


def signature(scope: dict[str, str], credential_id: str, secret: str) -> str:
    canonical = "\0".join(
        [credential_id, *(scope[key] for key in ("tenant_id", "workspace_id", "agent_id", "user_id", "channel_id", "session_id"))]
    )
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def principal_headers(environment: dict[str, str], *, credential_id: str, scope: dict[str, str]) -> dict[str, str]:
    registry = json.loads(environment["CORTEX_MEMORY_SCOPE_CREDENTIALS"])
    credential = registry.get(credential_id)
    if not isinstance(credential, dict) or not str(credential.get("secret") or ""):
        raise RuntimeError("canary credential is unavailable")
    headers = {
        "Content-Type": "application/json",
        "X-Cortex-Write-Token": environment["CORTEX_WRITE_TOKEN"],
        "X-Cortex-Scope-Credential-Id": credential_id,
        "X-Cortex-Scope-Signature": signature(scope, credential_id, str(credential["secret"])),
    }
    headers.update({PRINCIPAL_HEADERS[key]: value for key, value in scope.items()})
    return headers


def request_json(base: str, path: str, *, headers=None, payload=None, method="GET", timeout=30, expected=200):
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(base + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read(4 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read(4 * 1024 * 1024 + 1)
    if status != expected:
        raise RuntimeError(f"{method} {path} returned HTTP {status}")
    if len(raw) > 4 * 1024 * 1024:
        raise RuntimeError(f"{method} {path} exceeded response bound")
    return json.loads(raw.decode()) if raw else {}


def atomic_json(path: Path, payload: dict, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, mode)
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--env-file", default="/etc/cortex/cortex.env")
    parser.add_argument("--output", required=True)
    parser.add_argument("--credential-id", default="openclaw-production-v1")
    parser.add_argument("--manual-external-action-receipt")
    args = parser.parse_args()

    environment = load_env(Path(args.env_file))
    nonce = secrets.token_hex(8)
    scope = {
        "tenant_id": "openclaw-local",
        "workspace_id": "clawd",
        "agent_id": "main",
        "user_id": "jake",
        "channel_id": "whatsapp",
        # A fixed canary scope plus a fixed external graph id guarantees that
        # repeated canaries update one bounded row instead of leaking rows.
        "session_id": "openclaw-q9-canary",
    }
    headers = principal_headers(environment, credential_id=args.credential_id, scope=scope)
    checks = []

    def check(name: str, ok: bool, details=None):
        checks.append({"name": name, "ok": bool(ok), **({"details": details} if details is not None else {})})
        if not ok:
            raise RuntimeError(f"canary failed: {name}")

    health = request_json(args.base_url, "/health")
    ready = request_json(args.base_url, "/ready")
    check("health_readiness", health.get("readiness") is True and ready.get("ready") is True)

    external_id = "q9-live-canary"
    marker = hashlib.sha256(f"{nonce}:{dt.datetime.now(dt.timezone.utc).isoformat()}".encode()).hexdigest()
    created = request_json(
        args.base_url,
        "/knowledge/nodes",
        headers=headers,
        method="POST",
        timeout=120,
        payload={
            "id": external_id,
            "type": "Document",
            "name": f"q9 canary {marker[:12]}",
            "metadata": {"canary": True, "marker_sha256": marker, "fixed_resource": True},
        },
    )
    check("graph_fixed_resource_write", created.get("success") is True)
    retrieved = request_json(
        args.base_url,
        f"/knowledge/nodes/{urllib.parse.quote(external_id, safe='')}",
        headers=headers,
    )
    encoded = json.dumps(retrieved, sort_keys=True)
    check("graph_separate_read", retrieved.get("success") is True and marker in encoded)

    denied_scope = dict(scope)
    denied_scope["agent_id"] = "unregistered-q9-canary"
    denied_headers = principal_headers(environment, credential_id=args.credential_id, scope=denied_scope)
    denied = request_json(
        args.base_url,
        "/knowledge/search",
        headers=denied_headers,
        method="POST",
        payload={"query": marker, "top_k": 1},
        expected=403,
    )
    check("unauthorized_principal_denied", denied.get("error") == "principal is not authorized for the requested scope")

    oracle_scope = dict(scope)
    oracle_scope["agent_id"] = "oracle"
    oracle_scope["session_id"] = f"openclaw-q9-canary-oracle-{nonce}"
    oracle_headers = principal_headers(environment, credential_id=args.credential_id, scope=oracle_scope)
    oracle = request_json(
        args.base_url,
        "/oracle/chat",
        headers=oracle_headers,
        method="POST",
        timeout=180,
        payload={
            "prompt": "Return a short acknowledgement for a bounded q9 live canary.",
            "system": "No tools. This is an internal availability canary.",
            "model": "tinyllama",
        },
    )
    response = str(oracle.get("response") or "")
    receipt = oracle.get("completion_receipt") or {}
    check(
        "tinyllama_provider_receipt",
        bool(
            response
            and oracle.get("done") is True
            and oracle.get("provider_invoked") is True
            and oracle.get("degraded") is False
            and str(oracle.get("model") or "").split(":", 1)[0] == "tinyllama"
            and (oracle.get("routing_trace") or {}).get("path") == "requested_tinyllama"
            and receipt
        ),
        {
            "responseBytes": len(response.encode()),
            "responseSha256": hashlib.sha256(response.encode()).hexdigest(),
            "receiptSha256": hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest(),
        },
    )

    admin_headers = {
        "X-Cortex-Admin-Token": environment["CORTEX_ADMIN_TOKEN"],
        "X-Cortex-Write-Token": environment["CORTEX_WRITE_TOKEN"],
    }
    browser = request_json(args.base_url, "/browser/status", headers=admin_headers, expected=404)
    check("safe_mode_router_absent", browser.get("detail") == "Not Found")

    gateway = subprocess.run(
        ["/usr/bin/openclaw", "gateway", "status"],
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    check("openclaw_gateway", gateway.returncode == 0 and "Connectivity probe: ok" in gateway.stdout)

    external_action = {"status": "not_run", "reason": "explicit confirmation is required"}
    if args.manual_external_action_receipt:
        path = Path(args.manual_external_action_receipt)
        payload = json.loads(path.read_text(encoding="utf-8"))
        external_action = {
            "status": "green" if payload.get("outcome") == "green" else "red",
            "receiptSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        check("manual_external_action", external_action["status"] == "green")

    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    result = {
        "schemaVersion": "cortex.q9.live-canary.v1",
        "outcome": "green",
        "status": "green",
        "releaseId": environment.get("CORTEX_RELEASE_ID"),
        "checkCount": len(checks),
        "passedCheckCount": sum(1 for row in checks if row["ok"]),
        "failedCheckCount": sum(1 for row in checks if not row["ok"]),
        "checks": checks,
        "fixedGraphResource": True,
        "unboundedRowGrowth": False,
        "externalAction": external_action,
        "providerResponseContentsPersisted": False,
        "secretValuesPersisted": False,
        "verifiedAt": now,
        "truthBoundary": "A green canary proves current shadow-scope graph, auth, provider, safe-mode, and OpenClaw behavior. External action remains separately confirmed and never runs automatically.",
    }
    atomic_json(Path(args.output), result)
    print(json.dumps({
        "outcome": result["outcome"],
        "passedCheckCount": result["passedCheckCount"],
        "failedCheckCount": result["failedCheckCount"],
        "externalAction": external_action["status"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
