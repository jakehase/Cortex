#!/usr/bin/env python3
"""One focused smoke for MEM-2, MEM-3, AIOS-1, and source-side OPS-2."""
from __future__ import annotations

from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import uuid


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "public" / "cortex_server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))


def load_memory_governance():
    """Load the documented stdlib-only primitive without runtime package fan-out."""

    package_name = "cortex_server.runtime"
    package = types.ModuleType(package_name)
    package.__path__ = [str(SERVER_ROOT / "cortex_server" / "runtime")]
    sys.modules[package_name] = package
    module_name = f"{package_name}.memory_governance"
    path = SERVER_ROOT / "cortex_server" / "runtime" / "memory_governance.py"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("memory governance import spec unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


MEMORY_GOVERNANCE = load_memory_governance()
MemoryGovernanceStore = MEMORY_GOVERNANCE.MemoryGovernanceStore
temporal_visibility = MEMORY_GOVERNANCE.temporal_visibility


def require(condition: object, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def load_indexer():
    path = ROOT / "scripts" / "index-owner-memory.py"
    spec = importlib.util.spec_from_file_location("cortex_owner_indexer_repair_smoke", path)
    require(spec is not None and spec.loader is not None, "owner indexer import spec unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def run_json(command: list[str], *, env: dict[str, str] | None = None) -> dict:
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(
            f"command failed ({completed.returncode}): {' '.join(command)}\n"
            f"stdout={completed.stdout[-4000:]}\nstderr={completed.stderr[-4000:]}"
        )
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(f"command returned non-JSON: {' '.join(command)}") from exc
    require(isinstance(value, dict), "command JSON result must be an object")
    return value


def smoke_memory(temp_root: Path) -> dict[str, object]:
    store = MemoryGovernanceStore(temp_root / "memory-governance.sqlite3")
    principal = "principal:repair-smoke"
    common = {
        "claim_key": "claim.runtime-plane",
        "observed_at": "2026-10-12T00:00:00Z",
        "last_verified_at": "2026-10-12T00:00:00Z",
        "stale_after": "2030-01-01T00:00:00Z",
    }
    store.record_fact(
        principal_key=principal,
        memory_id="summary",
        content="The runtime is available.",
        metadata={**common, "fact_key": "summary", "fact_value": "available", "authority_rank": 40},
    )
    support_projection = store.record_fact(
        principal_key=principal,
        memory_id="support",
        content="The runtime is available through its internal lane.",
        metadata={**common, "fact_key": "support", "fact_value": "internal lane", "authority_rank": 50},
    )
    require(
        support_projection is not None
        and support_projection.active_winner_id == "support",
        "supporting component inherited an unrelated winner",
    )
    store.record_fact(
        principal_key=principal,
        memory_id="outage",
        content="The runtime is unavailable.",
        metadata={
            **common,
            "fact_key": "outage",
            "fact_value": "unavailable",
            "authority_rank": 90,
            "contradicts_ids": ["summary"],
        },
    )
    projected = store.conflict_projection(
        principal_key=principal,
        memory_ids=["summary", "support", "outage"],
    )
    require(projected["summary"]["fact_status"] == "conflicted", "explicit conflict loser not retained")
    require(projected["outage"]["fact_status"] == "active", "explicit conflict winner not active")
    require(projected["support"]["fact_status"] == "active", "supporting detail became a false conflict")

    store.record_fact(
        principal_key=principal,
        memory_id="current",
        content="Use the current runtime plane.",
        metadata={
            **common,
            "fact_key": "current",
            "fact_value": "current",
            "authority_rank": 100,
            "supersedes_json": '["outage"]',
        },
    )
    projected = store.conflict_projection(
        principal_key=principal,
        memory_ids=["summary", "support", "outage", "current"],
    )
    require(projected["outage"]["fact_status"] == "superseded", "explicit supersession did not dominate")
    require(projected["current"]["fact_status"] == "active", "replacement is not current")
    connection = store._connect()
    try:
        edges = [dict(row) for row in connection.execute("SELECT edge_type, reason FROM fact_edges").fetchall()]
    finally:
        connection.close()
    require(any(row == {"edge_type": "contradicts", "reason": "explicit_contradiction"} for row in edges), "genuine conflict edge missing")
    require(any(row == {"edge_type": "supersedes", "reason": "explicit_supersession"} for row in edges), "supersession history missing")

    historical = {
        "temporal_schema_version": "cortex.memory.temporal.v1",
        "temporal_kind": "state",
        "valid_from": "2026-01-01T00:00:00.000Z",
        "valid_to": "2026-02-01T00:00:00.000Z",
        "ingested_at": "2026-01-01T00:00:00.000Z",
        "memory_status": "superseded",
    }
    current = temporal_visibility(
        historical,
        now=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )
    january = temporal_visibility(
        historical,
        as_of="2026-01-15T00:00:00Z",
        now=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )
    require(not current.visible, "superseded temporal state remained co-current")
    require(january.visible, "as-of history was erased by supersession")
    return {"supportingCoCurrent": True, "explicitConflict": True, "supersessionHistory": True}


def owner_config() -> dict:
    shared = {
        "ownerSenderId": "+15550001111",
        "tenantId": "tenant-smoke",
        "workspaceId": "workspace-smoke",
        "agentId": "agent-smoke",
        "userId": "openclaw-owner",
        "channelId": "whatsapp",
        "sessionIdentityHmacSecret": "synthetic-session-secret",
        "scopeHmacSecret": "synthetic-scope-secret",
        "scopeCredentialId": "synthetic-scope-credential",
    }
    return {
        "plugins": {
            "entries": {
                "cortex-memory-bridge": {
                    "config": {
                        **shared,
                        "writeToken": "synthetic-write-token",
                        "baseUrl": "http://127.0.0.1:8000",
                    }
                },
                "cortex-route-gate": {"config": dict(shared)},
            }
        },
        "channels": {"whatsapp": {"allowFrom": [shared["ownerSenderId"]]}},
    }


def smoke_owner_gate(temp_root: Path) -> dict[str, object]:
    indexer = load_indexer()
    owner_root = temp_root / "owner"
    owner_root.mkdir()
    source = owner_root / "MEMORY.md"
    source.write_text("Owner prefers concise operational status updates.\n", encoding="utf-8")
    config_path = temp_root / "openclaw.json"
    config_path.write_text(json.dumps(owner_config()), encoding="utf-8")
    manifest_path = temp_root / "owner-sources.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schemaVersion": indexer.POLICY_SCHEMA,
                "authorizationBoundary": indexer.AUTHORIZATION_BOUNDARY,
                "sources": [
                    {
                        "path": "MEMORY.md",
                        "kind": "curated",
                        "classification": "owner_non_phi",
                        "approved": True,
                        "baaRequired": False,
                        "containsPhi": False,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    plugin, scope, _signature = indexer.signed_scope(owner_config())
    require(plugin["baseUrl"] == "http://127.0.0.1:8000", "owner scope fixture invalid")
    scope_digest = indexer.canonical_digest(scope)
    policies, policy_digest = indexer.load_policy(manifest_path)
    all_desired, sources = indexer.collect_desired(owner_root, policies, scope_digest=scope_digest)
    desired, quarantined = indexer.privacy_partition(all_desired)
    require(len(desired) == 1 and not quarantined, "safe owner source did not pass privacy partition")
    verified_at = indexer.utc_now()
    receipt = indexer._empty_receipt(scope_digest, policy_digest)
    receipt.update(
        {
            "accepted": {
                key: indexer._accepted_row(entry, f"owner-smoke-{ordinal}", verified_at)
                for ordinal, (key, entry) in enumerate(desired.items())
            },
            "sources": sources,
            "quarantined": quarantined,
            "lastRun": {
                "status": "current",
                "completedAt": verified_at,
                "semanticVerified": len(desired),
            },
            "lastVerification": {
                "status": "healthy",
                "checkedAt": verified_at,
                "semanticVerified": len(desired),
            },
            "health": {
                "status": "healthy",
                "reason": "semantic_readback_verified",
                "checkedAt": verified_at,
                "semanticVerified": len(desired),
            },
        }
    )
    receipt_path = temp_root / "owner-receipt.json"
    lock_path = temp_root / "owner-index.lock"
    indexer.atomic_write_receipt(receipt_path, receipt)
    receipt_before = receipt_path.read_bytes()
    calls = {"count": 0}

    def forbidden_client(**_kwargs):
        calls["count"] += 1
        raise AssertionError("unchanged source gate constructed the expensive backend client")

    common_args = [
        "apply",
        "--config", str(config_path),
        "--root", str(owner_root),
        "--manifest", str(manifest_path),
        "--receipt", str(receipt_path),
        "--lock", str(lock_path),
        "--verification-max-age-seconds", "3600",
    ]
    result = indexer.main(common_args, client_factory=forbidden_client)
    require(result["status"] == "current" and result["semanticReadback"]["checked"] == 0, "no-op gate did not defer semantic verification")
    require(result["verificationGate"]["decision"] == "source_unchanged_noop", "no-op gate evidence missing")
    require(calls["count"] == 0, "no-op gate crossed the backend boundary")
    require(receipt_path.read_bytes() == receipt_before, "no-op gate rewrote the durable receipt")

    class GateOpened(RuntimeError):
        pass

    def changed_client(**_kwargs):
        calls["count"] += 1
        raise GateOpened()

    source.write_text("Owner prefers concise operational status updates.\n- Source changed.\n", encoding="utf-8")
    try:
        indexer.main(common_args, client_factory=changed_client)
    except GateOpened:
        pass
    else:
        raise AssertionError("source change incorrectly took the no-op gate")
    require(calls["count"] == 1, "source change did not open the apply path")
    return {"unchangedBackendCalls": 0, "sourceChangeOpenedApply": True, "privacyBoundary": "preserved"}


def smoke_aios() -> dict[str, object]:
    artifact_root = ROOT / "ai-os" / f".memory-ops-smoke-{uuid.uuid4().hex}"
    artifact_root.mkdir(parents=True)
    source = artifact_root / "internal-adapter-status.aios"
    shutil.copyfile(ROOT / "ai-os" / "examples" / "internal-adapter-status.aios", source)
    adapter = ROOT / "scripts" / "aios-adapter.mjs"
    env = {**os.environ, "AIOS_OPERATOR": "repair-smoke", "AIOS_TENANT_ID": "repair-smoke"}
    try:
        compiled = run_json(["node", str(adapter), "compile", str(source), "--artifact-root", str(artifact_root)], env=env)
        require(compiled["outputContract"] == "durable-packet", "adapter did not consume the durable compile contract")
        require(compiled["packetType"] == "aios.language.compile.proof", "unexpected AI OS compile packet")
        require(compiled["boundary"] == {
            "mode": "internal-only",
            "tenantId": "repair-smoke",
            "workspaceId": "openclaw",
            "externalWrites": False,
            "externalTransportEffect": "none",
            "resultStorageExternalWrites": False,
            "remoteSideEffects": "none",
            "runtimeReplacement": False,
            "providerGrantCount": 0,
            "outputBoundary": "internal-artifact-only",
        }, "AI OS compile boundary changed")
        [job_path] = compiled["jobPaths"]
        run_json(["node", str(adapter), "boot", "--artifact-root", str(artifact_root)], env=env)
        run_json(["node", str(adapter), "run", job_path, "--artifact-root", str(artifact_root)], env=env)
        run_json(
            [
                "node",
                str(ROOT / "ai-os" / "apps" / "aios-verifier.mjs"),
                "--job", job_path,
                "--artifact-root", str(artifact_root),
                "--provider-policy", str(ROOT / "ai-os" / "kernel" / "policy" / "provider-read-compute.json"),
            ],
            env=env,
        )
        run_json(["node", str(adapter), "claim", job_path, "--artifact-root", str(artifact_root)], env=env)
        evaluation = run_json(
            [
                "node",
                "--input-type=module",
                "--eval",
                (
                    "import { AIOS_EVIDENCE_MAX_AGE_MS } from './ai-os/packages/aios-language/runtime/claim-evidence.mjs';"
                    "import { commandEvidenceRefresh, compactStatus } from './scripts/aios-adapter.mjs';"
                    "const root=process.env.SMOKE_AIOS_ROOT;"
                    "const future=new Date(Date.now()+AIOS_EVIDENCE_MAX_AGE_MS+60000);"
                    "const refresh=commandEvidenceRefresh({artifactRoot:root},{now:future});"
                    "const status=compactStatus(root,{now:future});"
                    "console.log(JSON.stringify({refresh,status}));"
                ),
            ],
            env={**env, "SMOKE_AIOS_ROOT": str(artifact_root)},
        )
        refresh = evaluation["refresh"]
        status = evaluation["status"]
        require(refresh["ok"] is True, "bounded AI OS evidence refresh was not green")
        require(refresh["effectBoundary"] == {
            "authorityExpanded": False,
            "capabilities": [],
            "providerCallsPerformed": False,
            "externalWritesPerformed": False,
            "localWrites": [str(artifact_root / "reports" / "evidence-refresh.json")],
        }, "AI OS refresh effect boundary changed")
        require(status["currentQualificationOk"] is False, "future status did not make execution evidence stale")
        require(status["evidenceRefreshOk"] is True and status["status"] == "green", "fresh bounded refresh did not recover status")
        require(status["claimBindingOk"] is False, "refresh improperly granted current completion authority")
        return {"refresh": "green", "externalWrites": False, "authorityExpanded": False, "promotionAuthority": False}
    finally:
        shutil.rmtree(artifact_root, ignore_errors=True)


def smoke_ops_contract() -> dict[str, object]:
    contract = json.loads((ROOT / "ops" / "contracts" / "stale-job-quarantine-recovery.v1.json").read_text(encoding="utf-8"))
    require(contract["liveMutationAuthorized"] is False, "stale-job contract authorized live mutation")
    require(contract["targetContract"]["targets"] == [], "source contract guessed live stale-job targets")
    require(contract["selectionPolicy"]["preserveActiveUserReminders"] is True, "active reminders are not protected")
    for unit in ("cortex-owner-memory-index.service", "cortex-owner-memory-index.timer"):
        require((ROOT / "ops" / "systemd" / unit).is_file(), f"missing source-side owner index unit: {unit}")
    return {"liveMutationAuthorized": False, "activeRemindersProtected": True, "recoveryDefined": True}


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cortex-memory-ops-smoke-") as temporary:
        temp_root = Path(temporary)
        result = {
            "schemaVersion": "cortex.memory-ops-repair-smoke.v1",
            "status": "passed",
            "checks": {
                "MEM-2": smoke_memory(temp_root),
                "MEM-3": smoke_owner_gate(temp_root),
                "AIOS-1": smoke_aios(),
                "OPS-2-source": smoke_ops_contract(),
            },
            "truthBoundary": "One focused local smoke proves only the assigned source paths; it does not deploy, mutate live databases/jobs, or qualify the full release.",
        }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
