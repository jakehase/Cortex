from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from fastapi import FastAPI

from cortex_server.modules.memory_scope import AuthenticatedMemoryPrincipal
from cortex_server.routers import nexus


def _principal(tenant: str, agent: str, session: str) -> AuthenticatedMemoryPrincipal:
    return AuthenticatedMemoryPrincipal(
        credential_id=f"credential-{agent}",
        tenant_id=tenant,
        workspace_id="shared-workspace",
        agent_id=agent,
        user_id=f"user-{agent}",
        channel_id="shared-channel",
        session_id=session,
    )


def test_referent_state_is_principal_scoped_persistent_and_legacy_quarantined(monkeypatch, tmp_path):
    state_path = tmp_path / "referents.json"
    state_path.write_text(
        json.dumps(
            {
                "updated_at": nexus._now_iso(),
                "last_fix_plan": "tenant legacy private fix plan",
                "last_codeword": "legacy-secret",
                "recent_turns": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(nexus, "_REFERENT_STATE_PATH", state_path)
    nexus._CONTEXT_STATES.clear()
    nexus._CONTEXT_QUARANTINE_CHECKED.clear()

    principal_a = _principal("tenant-a", "agent-a", "shared-session")
    principal_b = _principal("tenant-b", "agent-b", "shared-session")
    key_a = nexus._principal_continuity_key(principal_a, principal_a.session_id)
    key_b = nexus._principal_continuity_key(principal_b, principal_b.session_id)

    nexus._refresh_context("Use codeword amber-aegis", continuity_key=key_a)
    nexus._refresh_context(
        "The fix plan for flaky CI is tenant A private rollback sequence.",
        continuity_key=key_a,
    )
    nexus._refresh_context("Use codeword blue-bastion", continuity_key=key_b)

    a_codeword = nexus._resolve_referent_context("what was the codeword", continuity_key=key_a)
    a_plan = nexus._resolve_referent_context("what was that fix", continuity_key=key_a)
    b_codeword = nexus._resolve_referent_context("what was the codeword", continuity_key=key_b)
    b_plan = nexus._resolve_referent_context("what was that fix", continuity_key=key_b)

    assert a_codeword["codeword"] == "amber-aegis"
    assert "tenant A private rollback" in a_plan["reference_text"]
    assert b_codeword["codeword"] == "blue-bastion"
    assert b_plan["resolved"] is True
    assert b_plan["reference_text"] == ""
    assert "legacy" not in json.dumps((a_codeword, a_plan, b_codeword, b_plan))
    assert a_codeword["storage"] != b_codeword["storage"]
    assert state_path.with_name(f"{state_path.name}.legacy-unscoped.quarantine").exists()

    nexus._refresh_context("Use codeword poisoned-by-b", continuity_key=key_b)
    nexus._refresh_context("The fix plan is poison from tenant B.", continuity_key=key_b)
    assert nexus._resolve_referent_context("what was the codeword", continuity_key=key_a)["codeword"] == "amber-aegis"
    assert "tenant A private rollback" in nexus._resolve_referent_context(
        "what was that fix",
        continuity_key=key_a,
    )["reference_text"]

    # Simulate process restart: all in-memory buckets disappear and each
    # principal hydrates only its own authenticated namespace.
    nexus._CONTEXT_STATES.clear()
    assert nexus._resolve_referent_context("what was the codeword", continuity_key=key_a)["codeword"] == "amber-aegis"
    assert nexus._resolve_referent_context("what was the codeword", continuity_key=key_b)["codeword"] == "poisoned-by-b"


def test_all_adaptive_policy_state_and_rate_limits_are_principal_local(monkeypatch, tmp_path):
    monkeypatch.setattr(nexus, "_ADAPTIVE_STATE_ROOT", tmp_path / "adaptive")
    monkeypatch.setenv("NEXUS_OUTCOME_ARTIFACT_DIR", str(tmp_path / "outcomes"))
    monkeypatch.setenv("NEXUS_AUTOTUNE_TUNE_EVERY", "20")
    nexus._ADAPTIVE_POLICY_STATES.clear()
    nexus._ADAPTIVE_POLICY_RATE_KEYS.clear()
    nexus._PRINCIPAL_OUTCOME_TUNERS.clear()
    nexus._ADAPTIVE_OBSERVATION_RATES.clear()

    scope_a = _principal("tenant-a", "agent-a", "shared-session").storage_metadata
    scope_b = _principal("tenant-b", "agent-b", "shared-session").storage_metadata
    policies_a = nexus._adaptive_policies_for_scope(scope_a)
    policies_b = nexus._adaptive_policies_for_scope(scope_b)
    tuner_a = nexus._outcome_tuner_for_scope(scope_a)
    tuner_b = nexus._outcome_tuner_for_scope(scope_b)

    assert policies_a.scope_key != policies_b.scope_key
    assert policies_a.bandit.state_path != policies_b.bandit.state_path
    assert policies_a.delta.state_path != policies_b.delta.state_path
    assert policies_a.latency.state_path != policies_b.latency.state_path
    assert policies_a.routing_state_path != policies_b.routing_state_path
    assert policies_a.codec_policy_state_path != policies_b.codec_policy_state_path
    assert policies_a.codec_rollup_state_path != policies_b.codec_rollup_state_path
    assert tuner_a.state_path != tuner_b.state_path

    policies_a.bandit.update("simple", "fastlane_minimal", 0.0)
    policies_a.delta.update("tenant A chosen workload", [{"snippet": "private-a"}])
    policies_a.latency.observe(
        {
            "archetype": "simple_qa",
            "latency_ms": 9000,
            "token_budget_used": 4000,
            "escalated": True,
            "prefetch_used": False,
        }
    )
    for _ in range(20):
        nexus._scoped_routing_policy_call(
            policies_a,
            nexus.observe_outcome,
            "qa_fastlane",
            0.1,
            l9_used=False,
            complexity_score=0.1,
            intent_flags={},
        )
    nexus._scoped_codec_policy_call(
        policies_a,
        nexus.observe_codec_outcome,
        query="tenant A chosen codec workload",
        policy_label="query_only",
        execution_success=False,
        user_correction=True,
        recovery_needed=True,
        validator_pass=False,
        note="tenant-a-poison-attempt",
    )

    policy_a = nexus._scoped_routing_policy_call(policies_a, nexus.get_policy_snapshot)
    policy_b = nexus._scoped_routing_policy_call(policies_b, nexus.get_policy_snapshot)
    codec_b = nexus._scoped_codec_policy_call(policies_b, nexus.get_codec_policy_status)

    assert policy_a["fastlane_escalation_threshold"] != policy_b["fastlane_escalation_threshold"]
    assert policies_a.bandit.state["contexts"]["simple"]["fastlane_minimal"]["plays"] == 1
    assert policies_b.bandit.state["contexts"] == {}
    assert policies_b.delta.analyze("tenant B workload")["has_last"] is False
    assert policies_b.latency.state["count"] == 0
    assert codec_b["totals"]["evaluations"] == 0

    monkeypatch.setenv("NEXUS_ADAPTIVE_OBSERVATION_RATE_LIMIT", "1")
    assert nexus._adaptive_observation_allowed(scope_a) is True
    assert nexus._adaptive_observation_allowed(scope_a) is False
    assert nexus._adaptive_observation_allowed(scope_b) is True

    # Content state remains session-local, while the credential-scope parent
    # budget prevents allowed session rotation from minting fresh admission.
    scope_a_rotated_session = _principal("tenant-a", "agent-a", "another-session").storage_metadata
    policies_a_rotated = nexus._adaptive_policies_for_scope(scope_a_rotated_session)
    assert policies_a_rotated.scope_key != policies_a.scope_key
    assert policies_a_rotated.root != policies_a.root
    assert nexus._adaptive_observation_allowed(scope_a_rotated_session) is False


@pytest.mark.asyncio
async def test_feedback_receipt_signing_is_server_only_and_startup_validated(monkeypatch):
    signing_key = "dedicated-server-only-feedback-signing-key-0001"
    write_token = "caller-write-token"
    feedback_token = "caller-feedback-control-token"
    scope_secret = "caller-principal-scope-secret"
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", write_token)
    monkeypatch.setenv("NEXUS_OUTCOME_FEEDBACK_TOKEN", feedback_token)
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "caller": {
                    "secret": scope_secret,
                    "allowed_scopes": [
                        {
                            "tenant_id": "tenant-a",
                            "workspace_id": "workspace-a",
                            "agent_id": "agent-a",
                            "user_id": "user-a",
                            "channel_id": "channel-a",
                            "session_id": "session-a",
                        }
                    ],
                }
            }
        ),
    )

    async def run_startup() -> None:
        app = FastAPI()
        app.include_router(nexus.router, prefix="/nexus")
        async with app.router.lifespan_context(app):
            pass

    monkeypatch.delenv("NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY", raising=False)
    with pytest.raises(RuntimeError, match="production requires"):
        await run_startup()

    for caller_credential in (write_token, feedback_token, scope_secret):
        monkeypatch.setenv("NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY", caller_credential)
        with pytest.raises(RuntimeError, match="server-only"):
            await run_startup()

    monkeypatch.setenv("NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY", signing_key)
    await run_startup()

    scope = _principal("tenant-a", "agent-a", "session-a").storage_metadata
    issued = nexus._issue_outcome_feedback_receipt(
        scope=scope,
        execution_id="server-execution",
        query="server observed query",
        task_archetype="planning",
        policy_label="server-policy",
        codec_variant="query_only",
        validator_pass=True,
        execution_success=True,
        recovery_needed=False,
        latency_ms=42,
        outcome_confidence=0.9,
    )
    body_part, _ = issued["receipt"].split(".", 1)
    forged_payload = dict(issued["payload"])
    forged_payload["policy_label"] = "caller-forged-policy"
    forged_body = json.dumps(
        forged_payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")

    for caller_credential in (write_token, feedback_token, scope_secret):
        forged_signature = hmac.new(caller_credential.encode("utf-8"), forged_body, hashlib.sha256).digest()
        forged = f"{nexus._b64url_encode(forged_body)}.{nexus._b64url_encode(forged_signature)}"
        with pytest.raises(ValueError, match="signature_mismatch"):
            nexus._decode_outcome_feedback_receipt(forged)

    assert nexus._decode_outcome_feedback_receipt(issued["receipt"])["policy_label"] == "server-policy"
    assert body_part
