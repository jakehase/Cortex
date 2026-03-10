from fastapi import APIRouter
from fastapi.testclient import TestClient
import requests
from urllib.parse import quote

from cortex_server.main import create_app

router = APIRouter()


def _run_checks(get_json):
    checks = {}

    status, root = get_json("/")
    contract = (root or {}).get("contract", {}) if isinstance(root, dict) else {}
    checks["identity_phrase_contract_metadata_available"] = {
        "pass": status == 200 and bool(contract.get("identity_phrase")) and contract.get("activation_metadata_available") is True,
        "status": status,
        "identity_phrase": contract.get("identity_phrase"),
    }

    brainstorm_q = quote("Brainstorm: launch strategy options", safe=":")
    status, brainstorm = get_json(f"/nexus/orchestrate?query={brainstorm_q}")
    rm = (brainstorm or {}).get("routing_method")
    markers = (brainstorm or {}).get("routing_markers", {}) if isinstance(brainstorm, dict) else {}
    chain = markers.get("brainstorm_chain") if isinstance(markers, dict) else []
    checks["brainstorm_trigger_hard_routed"] = {
        "pass": status == 200 and rm == "brainstorm_chain_forced" and markers.get("brainstorm_triggered") is True and chain == ["dreamer", "muse", "synthesist"],
        "status": status,
        "routing_method": rm,
        "routing_markers": markers,
    }

    status, orches = get_json("/nexus/orchestrate?query=What%20is%202%2B2%3F")
    rm2 = (orches or {}).get("routing_method") if isinstance(orches, dict) else None
    checks["routing_method_present_truthful"] = {
        "pass": status == 200 and isinstance(rm2, str) and len(rm2) > 0,
        "status": status,
        "routing_method": rm2,
    }

    status, missing = get_json("/definitely_missing_route")
    checks["404_has_no_hud_attribution"] = {
        "pass": status == 404 and isinstance(missing, dict) and ("hud" not in missing) and ("activated_levels" not in missing),
        "status": status,
        "body": missing,
    }

    overall = all(item["pass"] for item in checks.values())
    return {
        "success": overall,
        "checks": checks,
        "verdict": "pass" if overall else "fail",
    }


@router.get("/self-test")
async def contract_self_test(base_url: str = ""):
    # Default: in-process checks (no network self-call deadlock)
    if not base_url:
        app = create_app()
        client = TestClient(app)

        def _local_get_json(path: str):
            r = client.get(path)
            body = r.json() if "application/json" in (r.headers.get("content-type") or "") else None
            return r.status_code, body

        return _run_checks(_local_get_json)

    def _remote_get_json(path: str):
        url = f"{base_url.rstrip('/')}{path}"
        r = requests.get(url, timeout=6)
        body = r.json() if "application/json" in (r.headers.get("content-type") or "") else None
        return r.status_code, body

    return _run_checks(_remote_get_json)
