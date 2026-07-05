import json
from datetime import datetime, timezone

from cortex_server.modules.prior_art_gate import build_prior_art_gate, extract_prior_art_terms


def test_prior_art_gate_blocks_new_primitive_when_existing_capability_is_recalled():
    gate = build_prior_art_gate(
        objective="Implement a run ledger and release packet for proof carrying artifacts",
        planned_capabilities=["run ledger", "release packet", "proof carrying claim ledger"],
        planned_paths=["packages/synthetic-labor-os/index.mjs"],
        proposed_action="new_primitive",
        memory_results=[{
            "id": "memory-proof-ledger",
            "text": "Implemented proof-carrying claim ledger with adversarial verifiers and merge credit blocking.",
            "score": 0.81,
            "metadata": {"source": "curated-project-facts", "quality": "curated", "path": "memory/projects/100-agent-orchestration.md"},
        }],
        structural_results=[{
            "node": {
                "id": "Function:buildProofCarryingClaimLedger",
                "type": "Function",
                "name": "buildProofCarryingClaimLedger",
                "uri": "packages/proof-carrying-claim-ledger/index.mjs",
            }
        }],
    )

    assert gate["ok"] is False
    assert gate["decision"] == "extend_existing_or_adapter_required"
    assert "high_confidence_prior_art_requires_reuse_or_extension" in gate["failures"]
    assert gate["sourceCoverage"]["highConfidenceMatchCount"] >= 1


def test_prior_art_gate_allows_adapter_when_prior_art_is_explicitly_acknowledged():
    gate = build_prior_art_gate(
        objective="Package SLOS v19 as an adapter over the existing proof carrying claim ledger and release bundle",
        planned_capabilities=["run ledger", "release packet"],
        proposed_action="adapter_wrapper_only",
        memory_results=[{
            "id": "memory-release-bundle",
            "text": "SLOS v11 release bundle packages evidence and SHA256 checksums; v6 provenance chain links proposal approval apply and validation.",
            "score": 0.77,
            "metadata": {"source": "curated-project-facts", "quality": "curated"},
        }],
    )

    assert gate["ok"] is True
    assert gate["decision"] == "adapter_wrapper_only"
    assert gate["warnings"] == ["prior_art_found_action_scoped_to_existing_capability"]


def test_prior_art_term_extraction_expands_known_ledger_aliases():
    terms = extract_prior_art_terms(objective="Build a release packet with a run ledger", planned_capabilities=[], planned_paths=[])

    assert "run ledger" in terms
    assert "execution transaction" in terms
    assert "release bundle" in terms


def test_prior_art_gate_output_is_json_serializable_with_structural_datetimes():
    gate = build_prior_art_gate(
        objective="Reuse the Cortex prior art gate for hard dogfood release packets",
        planned_capabilities=["prior art gate", "release packet"],
        proposed_action="reuse_existing",
        structural_results=[{
            "node": {
                "id": "Function:priorArtGateWithDatetime",
                "type": "Function",
                "name": "prior art gate",
                "uri": "cortex_server/modules/prior_art_gate.py",
                "updated_at": datetime(2026, 6, 30, tzinfo=timezone.utc),
            }
        }],
    )

    encoded = json.dumps(gate)
    assert "2026-06-30" in encoded
    assert gate["ok"] is True
