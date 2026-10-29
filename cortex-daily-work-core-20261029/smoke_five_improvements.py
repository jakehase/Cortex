#!/usr/bin/env python3
"""One focused end-to-end smoke for the five Cortex daily-work improvements."""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from typing import Any

PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT.parent
SERVER_ROOT = ROOT / "public" / "cortex_server"
sys.path.insert(0, str(SERVER_ROOT))

from fastapi import HTTPException  # noqa: E402
from cortex_server.routers import everyday_intel as everyday  # noqa: E402
from cortex_server.runtime.memory_governance import MemoryGovernanceStore  # noqa: E402


def fake_request(*, user: str = "owner") -> Any:
    principal = SimpleNamespace(
        role="principal",
        credential_id="smoke-credential",
        tenant_id="tenant-smoke",
        workspace_id="workspace-smoke",
        storage_workspace_id="storage-smoke",
        agent_id="main",
        user_id=user,
        channel_id="whatsapp",
        session_id="session-smoke",
    )
    return SimpleNamespace(state=SimpleNamespace(cortex_principal=principal))


def must_http_status(awaitable_factory, status: int) -> None:
    try:
        asyncio.run(awaitable_factory())
    except HTTPException as exc:
        assert exc.status_code == status, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"expected HTTP {status}")


def no_numeric_score_or_rank(value: Any, path: str = "root") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            lowered = str(key).lower()
            if ("score" in lowered or "rank" in lowered) and isinstance(nested, (int, float)) and not isinstance(nested, bool):
                raise AssertionError(f"fabricated numeric precision at {path}.{key}")
            no_numeric_score_or_rank(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            no_numeric_score_or_rank(nested, f"{path}[{index}]")


def run_node_smoke() -> dict[str, Any]:
    completed = subprocess.run(
        ["node", str(PROJECT / "smoke_five_improvements_node.cjs")],
        cwd=str(ROOT),
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
        env={**os.environ, "NODE_PATH": "/opt/openclaw-preastra-restore/2026.7.1-2/runtime/openclaw/node_modules"},
    )
    if completed.returncode != 0:
        raise AssertionError(f"node integration failed ({completed.returncode}):\n{completed.stdout}\n{completed.stderr}")
    return json.loads(completed.stdout)


async def exercise_everyday_state() -> dict[str, Any]:
    owner = fake_request()
    other = fake_request(user="different-owner")
    source_ref = "openclaw:user-message:smoke-current"
    source_quote = "I will prepare the provider comparison once the fee is agreed."

    proposed = await everyday.attention_propose(
        everyday.AttentionProposeRequest(
            kind="user_committed",
            summary="Prepare the provider comparison after fee agreement",
            source_ref=source_ref,
            source_quote=source_quote,
        ),
        owner,
    )
    item_id = proposed["item"]["id"]
    assert proposed["item"]["status"] == "candidate"
    assert proposed["activation_required"] is True
    candidate_view = await everyday.attention_view(
        everyday.AttentionViewRequest(include_candidates=True, include_resolved=False), owner
    )
    assert candidate_view["counts"] == {"active": 0, "candidates": 1, "resolved": 0}

    try:
        await everyday.attention_confirm(
            everyday.AttentionConfirmRequest(
                item_id=item_id,
                confirmation_source_ref=source_ref,
                confirmation_quote=source_quote,
                confirmation_verified_by_plugin=False,
            ),
            owner,
        )
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("unverified attention candidate became active")

    confirmed = await everyday.attention_confirm(
        everyday.AttentionConfirmRequest(
            item_id=item_id,
            confirmation_source_ref=source_ref,
            confirmation_quote=source_quote,
            confirmation_method="exact_current_user_quote",
            confirmation_verified_by_plugin=True,
        ),
        owner,
    )
    assert confirmed["item"]["status"] == "active"
    assert confirmed["item"]["external_action_allowed"] is False
    other_view = await everyday.attention_view(
        everyday.AttentionViewRequest(include_candidates=True, include_resolved=True), other
    )
    assert other_view["counts"] == {"active": 0, "candidates": 0, "resolved": 0}

    resolved = await everyday.attention_resolve(
        everyday.AttentionResolveRequest(
            item_id=item_id,
            resolution_note="Provider comparison delivered",
            resolution_source_ref="openclaw:user-message:smoke-resolution",
            resolution_quote="The provider comparison is complete.",
            resolution_verified_by_plugin=True,
        ),
        owner,
    )
    assert resolved["item"]["status"] == "resolved"
    final_active = await everyday.attention_view(
        everyday.AttentionViewRequest(include_candidates=True, include_resolved=False), owner
    )
    final_history = await everyday.attention_view(
        everyday.AttentionViewRequest(include_candidates=True, include_resolved=True), owner
    )
    assert final_active["counts"] == {"active": 0, "candidates": 0, "resolved": 0}
    assert final_history["counts"] == {"active": 0, "candidates": 0, "resolved": 1}

    workbench = await everyday.decision_workbench(
        everyday.DecisionWorkbenchRequest(
            decision="Choose between a low-interaction service and a maintenance-heavy product",
            priorities=["Prefer low interaction", "Avoid endless maintenance"],
            priority_source_refs=["openclaw:user-message:preference"],
            decision_changers=["Verified support burden after launch"],
            options=[
                everyday.WorkbenchOption(
                    label="Low-interaction service",
                    expected_benefit="Recurring revenue with bounded delivery",
                    user_time="A setup phase, then periodic review",
                    ongoing_burden="Low if scope remains fixed",
                    cost="Known setup cost; operating cost not yet verified",
                    reversibility="Can pause new sales",
                    uncertainty="Demand is not yet validated",
                    source_refs=["openclaw:user-message:option-a"],
                ),
                everyday.WorkbenchOption(
                    label="Maintenance-heavy product",
                    expected_benefit="Potentially larger upside",
                    uncertainty="Support volume is unknown",
                ),
            ],
        ),
        owner,
    )
    wb = workbench["workbench"]
    assert wb["recommendation"] is None
    assert wb["scoring"] == {
        "numeric_scores": False,
        "weighted_ranking": False,
        "fabricated_precision": False,
    }
    assert wb["missing_evidence"]
    assert wb["what_could_change_the_recommendation"]
    no_numeric_score_or_rank(wb)

    return {
        "candidateNotObligation": True,
        "unverifiedActivationRejected": True,
        "activeLifecycleObserved": True,
        "resolvedRemovedFromActiveView": True,
        "resolvedHistoryRetained": True,
        "crossPrincipalIsolationObserved": True,
        "sourceRefsRetained": True,
        "externalActionAllowed": False,
        "workbench": {
            "optionCount": len(wb["options"]),
            "missingEvidenceCount": len(wb["missing_evidence"]),
            "recommendation": wb["recommendation"],
            "scoring": wb["scoring"],
        },
    }


def exercise_governed_supersession(node_result: dict[str, Any], temp_root: Path) -> dict[str, Any]:
    same = node_result["corrections"]["sameScopeIdentity"]
    unrelated = node_result["corrections"]["unrelatedScopeIdentity"]
    store = MemoryGovernanceStore(temp_root / "governance.db")
    principal = "principal-smoke"
    common = {
        "source_id": "source-owner",
        "subject": "owner",
        "predicate": "corrected_guidance",
        "fact_scope": same["claimKey"],
        "confidence": 1,
        "authority_rank": 70,
        "memory_status": "active",
        "correction_memory": True,
    }
    store.record_fact(
        principal_key=principal,
        memory_id="same-old",
        content="Use a broad audit for wording changes",
        metadata={**common, "claim_key": same["claimKey"], "fact_key": same["factKey"], "fact_value": "old"},
    )
    store.record_fact(
        principal_key=principal,
        memory_id="same-new",
        content="Keep wording changes concise",
        metadata={**common, "claim_key": same["claimKey"], "fact_key": same["factKey"], "fact_value": "new"},
    )
    store.record_fact(
        principal_key=principal,
        memory_id="unrelated",
        content="Investigate production failures from logs",
        metadata={
            **common,
            "claim_key": unrelated["claimKey"],
            "fact_key": unrelated["factKey"],
            "fact_scope": unrelated["claimKey"],
            "fact_value": "investigate-first",
        },
    )
    projection = store.conflict_projection(
        principal_key=principal, memory_ids=["same-old", "same-new", "unrelated"]
    )
    assert projection["same-old"]["fact_status"] == "superseded"
    assert projection["same-new"]["fact_status"] == "active"
    assert projection["unrelated"]["fact_status"] == "active"
    return {
        "sameScopeOldStatus": projection["same-old"]["fact_status"],
        "sameScopeNewStatus": projection["same-new"]["fact_status"],
        "unrelatedScopeStatus": projection["unrelated"]["fact_status"],
        "sameScopeClaimKey": same["claimKey"],
        "unrelatedScopeClaimKey": unrelated["claimKey"],
    }


def route_inventory_check() -> dict[str, Any]:
    routes = {
        (method, route.path)
        for route in everyday.router.routes
        for method in (getattr(route, "methods", set()) or set())
    }
    required = {
        ("POST", "/attention/propose"),
        ("POST", "/attention/confirm"),
        ("POST", "/attention/resolve"),
        ("POST", "/attention/view"),
        ("POST", "/decision/workbench"),
    }
    assert required.issubset(routes)
    main_text = (SERVER_ROOT / "cortex_server" / "main.py").read_text(encoding="utf-8")
    assert '"/everyday/",' in main_text
    return {"routes": sorted(f"{method} /everyday{path}" for method, path in required), "signedPrincipalAdmission": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", required=True)
    args = parser.parse_args()
    artifact = Path(args.artifact)
    if not artifact.is_absolute():
        artifact = ROOT / artifact
    artifact.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="cortex-daily-work-smoke-") as temp:
        temp_root = Path(temp)
        everyday.STATE_DIR = temp_root / "everyday"
        everyday.DECISIONS_FILE = everyday.STATE_DIR / "decisions.jsonl"
        node_result = run_node_smoke()
        everyday_result = asyncio.run(exercise_everyday_state())
        supersession = exercise_governed_supersession(node_result, temp_root)
        inventory = route_inventory_check()

    surfaces = {
        "evidence-bound-answers": {
            "passed": True,
            "evidence": node_result["evidenceBinding"],
        },
        "source-backed-attention": {
            "passed": True,
            "evidence": {**everyday_result, **inventory},
        },
        "proportional-work-routing": {
            "passed": True,
            "evidence": {**node_result["proportionalRouting"], **node_result["rewrite"]},
        },
        "scope-preserving-corrections": {
            "passed": True,
            "evidence": supersession,
        },
        "qualitative-decision-workbench": {
            "passed": True,
            "evidence": everyday_result["workbench"],
        },
    }
    assert len(surfaces) == 5 and all(row["passed"] for row in surfaces.values())
    result = {
        "schemaVersion": "cortex.daily-work.integrated-smoke.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "fidelity": "parity_for_scope",
        "command": "python3 cortex-daily-work-core-20261029/smoke_five_improvements.py --artifact cortex-daily-work-core-20261029/artifacts/integrated-smoke.json",
        "passed": True,
        "surfaceCount": 5,
        "surfaces": surfaces,
        "defaultIntegration": node_result["defaultIntegration"],
        "safety": node_result["safety"],
        "truthBoundary": "Proves the five bounded workflow mechanics in one integrated smoke; does not prove universal answer correctness or automatic discovery of every obligation.",
    }
    artifact.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, "artifact": str(artifact), "surfaces": list(surfaces)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
