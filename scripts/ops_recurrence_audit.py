#!/usr/bin/env python3
"""Machine-readable, read-only operations recurrence audits.

Subcommands inspect listener intent, secret-file permissions, host resources, and
failed units. There is intentionally no mutating mode: this helper cannot change
firewalls, listeners, permissions, cgroups, units, services, or files.
"""
from __future__ import annotations

import argparse
import json
import os
import pwd
import grp
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _result(kind: str, checks: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    failed = [item for item in checks if item.get("required", True) and not item.get("passed")]
    return {
        "schema": f"cortex.ops-audit.{kind}.v1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "ok": not failed,
        "checks": checks,
        "failedChecks": [item["name"] for item in failed],
        "mutationSupported": False,
        "mutationPerformed": False,
        **extra,
    }


def parse_ss(text: str) -> list[dict[str, Any]]:
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("netid"):
            continue
        parts = line.split()
        if len(parts) < 5 or parts[0] not in {"tcp", "udp"}:
            continue
        local = parts[4]
        if "]:" in local:
            host, port = local.rsplit(":", 1); host = host.strip("[]")
        elif ":" in local:
            host, port = local.rsplit(":", 1)
        else:
            continue
        if not port.isdigit():
            continue
        owner = None; pid = None
        match = re.search(r'users:\(\("([^\"]+)"[^)]*pid=(\d+)', line)
        if match:
            owner, pid = match.group(1), int(match.group(2))
        wildcard = host in {"0.0.0.0", "::", "*", "[::]"}
        rows.append({"protocol": parts[0], "state": parts[1], "host": host, "port": int(port), "wildcard": wildcard, "process": owner, "pid": pid, "rawFingerprint": __import__("hashlib").sha256(line.encode()).hexdigest()})
    return rows


def listener_audit(text: str, policy: dict[str, Any]) -> dict[str, Any]:
    intents = policy.get("listeners") or []
    rows = parse_ss(text); checks = []; matrix = []
    for row in rows:
        matches = []
        for intent in intents:
            if str(intent.get("protocol", row["protocol"])) != row["protocol"] or int(intent.get("port", -1)) != row["port"]:
                continue
            owner_re = str(intent.get("processRegex") or ".*")
            if not re.fullmatch(owner_re, str(row.get("process") or "")):
                continue
            allowed = intent.get("allowedBinds") or []
            bind_ok = not allowed or row["host"] in allowed or (row["wildcard"] and "wildcard" in allowed)
            matches.append((intent, bind_ok))
        classified = len(matches) == 1
        bind_ok = classified and matches[0][1]
        intent_id = matches[0][0].get("id") if classified else None
        passed = classified and bind_ok
        required = row["wildcard"] or bool(policy.get("requireAllListenersClassified", True))
        checks.append({"name": f"listener:{row['protocol']}:{row['host']}:{row['port']}", "required": required, "passed": passed, "observed": {"classified": classified, "intentId": intent_id, "bindAllowed": bind_ok}})
        matrix.append({**row, "classified": classified, "intentId": intent_id, "bindAllowed": bind_ok})
    for intent in intents:
        if intent.get("required"):
            present = any(row.get("intentId") == intent.get("id") for row in matrix)
            checks.append({"name": f"required_intent:{intent.get('id')}", "required": True, "passed": present, "observed": present})
    return _result("listeners", checks, listenerMatrix=matrix)


def permission_audit(policy: dict[str, Any]) -> dict[str, Any]:
    checks = []; files = []
    for item in policy.get("paths") or []:
        path = Path(str(item.get("path")))
        required = bool(item.get("required", True))
        try:
            stat = path.lstat()
            mode = stat.st_mode & 0o777
            allowed_modes = {int(str(value), 8) for value in item.get("allowedModes") or ["0600"]}
            owner = pwd.getpwuid(stat.st_uid).pw_name
            group = grp.getgrgid(stat.st_gid).gr_name
            owner_ok = not item.get("allowedOwners") or owner in item.get("allowedOwners")
            mode_ok = mode in allowed_modes
            regular = path.is_file() and not path.is_symlink()
            passed = regular and mode_ok and owner_ok
            observed = {"exists": True, "regular": regular, "mode": f"{mode:04o}", "owner": owner, "group": group, "bytes": stat.st_size}
        except (FileNotFoundError, PermissionError, KeyError, OSError) as exc:
            passed = not required and isinstance(exc, FileNotFoundError)
            observed = {"exists": False, "error": type(exc).__name__}
        checks.append({"name": f"permission:{path}", "required": required, "passed": passed, "observed": observed})
        files.append({"path": str(path), **observed})
    return _result("permissions", checks, files=files, fileContentsRead=False, contentDigestsRecorded=False)


def resource_audit(paths: list[str], *, min_available_bytes: int, max_disk_percent: float, max_load_per_cpu: float) -> dict[str, Any]:
    checks = []
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1); mem[key] = int(value.strip().split()[0]) * 1024
    available = mem.get("MemAvailable", 0)
    checks.append({"name": "memory_available", "required": True, "passed": available >= min_available_bytes, "observed": available, "threshold": min_available_bytes})
    load1 = os.getloadavg()[0]; cpus = os.cpu_count() or 1; ratio = load1 / cpus
    checks.append({"name": "load_per_cpu", "required": True, "passed": ratio <= max_load_per_cpu, "observed": ratio, "threshold": max_load_per_cpu})
    disks = []
    for path in paths:
        usage = shutil.disk_usage(path); percent = (usage.used / usage.total * 100) if usage.total else 100.0
        checks.append({"name": f"disk:{path}", "required": True, "passed": percent <= max_disk_percent, "observed": round(percent, 3), "threshold": max_disk_percent})
        disks.append({"path": path, "total": usage.total, "used": usage.used, "free": usage.free, "usedPercent": round(percent, 3)})
    return _result("resources", checks, memory={"available": available, "total": mem.get("MemTotal")}, load={"oneMinute": load1, "cpuCount": cpus, "perCpu": ratio}, disks=disks)


def parse_failed_units(text: str) -> list[dict[str, str]]:
    units = []
    for line in text.splitlines():
        parts = line.strip().lstrip("●").split(None, 4)
        if len(parts) >= 3 and parts[2] == "failed":
            units.append({"unit": parts[0], "load": parts[1], "active": parts[2], "sub": parts[3] if len(parts) > 3 else "", "description": parts[4] if len(parts) > 4 else ""})
    return units


def failed_units_audit(text: str, policy: dict[str, Any]) -> dict[str, Any]:
    allowed = {item.get("unit"): item for item in policy.get("classifications") or []}
    units = parse_failed_units(text); checks = []; classified = []
    for unit in units:
        classification = allowed.get(unit["unit"])
        allowed_failure = bool(classification and classification.get("allowedFailure"))
        checks.append({"name": f"failed_unit:{unit['unit']}", "required": True, "passed": allowed_failure, "observed": {"classified": bool(classification), "allowedFailure": allowed_failure, "reason": classification.get("reason") if classification else None}})
        classified.append({**unit, "classification": classification})
    return _result("failed-units", checks, failedUnits=classified)


def bounded_command(command: list[str], timeout: float) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"command_exit_{result.returncode}")
    return result.stdout


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    listeners = sub.add_parser("listeners"); listeners.add_argument("--policy", required=True); listeners.add_argument("--ss-file"); listeners.add_argument("--timeout", type=float, default=5.0)
    perms = sub.add_parser("permissions"); perms.add_argument("--policy", required=True)
    resources = sub.add_parser("resources"); resources.add_argument("--path", action="append", default=["/"]); resources.add_argument("--min-available-bytes", type=int, default=512 * 1024 * 1024); resources.add_argument("--max-disk-percent", type=float, default=90.0); resources.add_argument("--max-load-per-cpu", type=float, default=2.0)
    failed = sub.add_parser("failed-units"); failed.add_argument("--policy", required=True); failed.add_argument("--systemctl-file"); failed.add_argument("--user", action="store_true"); failed.add_argument("--timeout", type=float, default=5.0)
    for child in (listeners, perms, resources, failed): child.add_argument("--output")
    args = parser.parse_args()
    try:
        if args.command == "listeners":
            text = Path(args.ss_file).read_text() if args.ss_file else bounded_command(["ss", "-H", "-lntup"], args.timeout)
            result = listener_audit(text, load_json(args.policy))
        elif args.command == "permissions": result = permission_audit(load_json(args.policy))
        elif args.command == "resources": result = resource_audit(args.path, min_available_bytes=args.min_available_bytes, max_disk_percent=args.max_disk_percent, max_load_per_cpu=args.max_load_per_cpu)
        else:
            cmd = ["systemctl"] + (["--user"] if args.user else []) + ["--failed", "--no-legend", "--plain"]
            text = Path(args.systemctl_file).read_text() if args.systemctl_file else bounded_command(cmd, args.timeout)
            result = failed_units_audit(text, load_json(args.policy))
    except Exception as exc:
        result = {"schema": f"cortex.ops-audit.{args.command}.v1", "ok": False, "error": type(exc).__name__, "mutationSupported": False, "mutationPerformed": False}
    text = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        out=Path(args.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(text+"\n")
    print(text)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
