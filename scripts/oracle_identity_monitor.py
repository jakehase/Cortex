#!/usr/bin/env python3
"""Bounded, read-only Oracle configuration/identity recurrence monitor.

The monitor never invokes a model. It evaluates explicit status/health payloads and
keeps required-primary policy separate from optional disabled fallbacks.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def fetch_json(url: str, timeout: float) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"http_status_{response.status}")
        return json.loads(response.read(2 * 1024 * 1024).decode("utf-8"))


def load_payload(path: str | None, url: str, timeout: float) -> dict[str, Any]:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    return fetch_json(url, timeout)


def evaluate(oracle: dict[str, Any], executor: dict[str, Any] | None = None, *, require_provider_canary: bool = False) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def check(name: str, passed: bool, observed: Any, required: bool = True) -> None:
        checks.append({"name": name, "required": required, "passed": bool(passed), "observed": observed})

    primary = oracle.get("primary_backend") if isinstance(oracle.get("primary_backend"), dict) else {}
    model = primary.get("model") if isinstance(primary.get("model"), dict) else {}
    executable = primary.get("executable") if isinstance(primary.get("executable"), dict) else {}
    check("primary_declared_required", primary.get("required") is True, primary.get("required"))
    check("primary_model_configured", model.get("configured") is True and bool(model.get("model")), model.get("model"))
    check("primary_executable_available", executable.get("available") is True, executable.get("resolvedPath"))
    check("primary_readiness", primary.get("ready") is True, primary.get("ready"))
    check("status_does_not_authorize_provider", primary.get("providerCallAuthorizedByStatus") is False, primary.get("providerCallAuthorizedByStatus"))
    check("provider_canary", primary.get("providerCallVerified") is True, primary.get("providerCallVerified"), required=require_provider_canary)

    optional = oracle.get("optional_backends") if isinstance(oracle.get("optional_backends"), dict) else {}
    for name, state in optional.items():
        state = state if isinstance(state, dict) else {}
        enabled = state.get("enabled") is True
        check(f"optional_{name}", (not enabled) or state.get("healthy") is True, {"enabled": enabled, "healthy": state.get("healthy")}, required=enabled)

    if executor is not None:
        identity = executor.get("modelIdentity") if isinstance(executor.get("modelIdentity"), dict) else {}
        check("executor_thinking_xhigh", executor.get("thinking") == "xhigh", executor.get("thinking"))
        check("executor_actual_identity_required", identity.get("actualIdentityRequiredPerInvocation") is True, identity.get("actualIdentityRequiredPerInvocation"))
        expected = identity.get("expected")
        check("executor_expected_model_pin", bool(expected), expected, required=False)
        check("executor_health_no_provider_call", executor.get("providerCallMadeByHealth") is False, executor.get("providerCallMadeByHealth"))

    failed = [c for c in checks if c["required"] and not c["passed"]]
    return {
        "schema": "cortex.oracle-identity-monitor.v1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "ok": not failed,
        "providerCallMade": False,
        "checks": checks,
        "failedRequiredChecks": [c["name"] for c in failed],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--oracle-url", default="http://127.0.0.1:8000/oracle/status")
    parser.add_argument("--executor-url")
    parser.add_argument("--oracle-file")
    parser.add_argument("--executor-file")
    parser.add_argument("--timeout", type=float, default=4.0)
    parser.add_argument("--require-provider-canary", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        oracle = load_payload(args.oracle_file, args.oracle_url, args.timeout)
        executor = None
        if args.executor_file or args.executor_url:
            executor = load_payload(args.executor_file, args.executor_url or "", args.timeout)
        result = evaluate(oracle, executor, require_provider_canary=args.require_provider_canary)
    except Exception as exc:
        result = {
            "schema": "cortex.oracle-identity-monitor.v1",
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "ok": False,
            "providerCallMade": False,
            "error": type(exc).__name__,
        }
    text = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
