#!/usr/bin/env python3
"""One bounded end-to-end mechanical smoke for Cortex memory lifecycle v6.

This is intentionally the release's only pre-deployment smoke. It uses
isolated temporary state, synthetic/no-PHI data, no network, and no production
mutation. A pass proves only the exercised mechanical paths.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "public" / "cortex_server"
ARTIFACT = Path("/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/smoke.json")


def require(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def metadata_matches(metadata: dict[str, Any], where: Any) -> bool:
    if not where:
        return True
    if "$and" in where:
        return all(metadata_matches(metadata, item) for item in where["$and"])
    if "$or" in where:
        return any(metadata_matches(metadata, item) for item in where["$or"])
    for key, wanted in where.items():
        actual = metadata.get(key)
        if isinstance(wanted, dict):
            if "$in" in wanted and actual not in wanted["$in"]:
                return False
            if "$ne" in wanted and actual == wanted["$ne"]:
                return False
            if "$lte" in wanted and not (actual is not None and actual <= wanted["$lte"]):
                return False
            if "$gte" in wanted and not (actual is not None and actual >= wanted["$gte"]):
                return False
        elif actual != wanted:
            return False
    return True


class FakeCollection:
    def __init__(self, records: dict[str, dict[str, Any]]) -> None:
        self.records = records

    def get(self, *, ids=None, where=None, include=None, **_kwargs):
        requested = set(str(item) for item in ids) if ids is not None else None
        selected = [
            (memory_id, row)
            for memory_id, row in self.records.items()
            if (requested is None or memory_id in requested)
            and metadata_matches(dict(row["metadata"]), where)
        ]
        result: dict[str, Any] = {"ids": [item[0] for item in selected]}
        if include is None or "metadatas" in include:
            result["metadatas"] = [dict(item[1]["metadata"]) for item in selected]
        if include is None or "documents" in include:
            result["documents"] = [str(item[1].get("document") or "") for item in selected]
        return result

    def delete(self, *, ids, **_kwargs):
        for memory_id in list(ids):
            self.records.pop(str(memory_id), None)

    def update(self, *, ids, metadatas=None, documents=None, **_kwargs):
        for index, memory_id in enumerate(ids):
            row = self.records[str(memory_id)]
            if metadatas is not None:
                row["metadata"] = dict(metadatas[index])
            if documents is not None:
                row["document"] = str(documents[index])


def configure_isolated_environment(root: Path) -> None:
    values = {
        "CORTEX_CHROMA_DIR": root / "chroma",
        "CORTEX_MEMORY_GOVERNANCE_DB": root / "chroma" / "memory-governance.sqlite3",
        "LIBRARIAN_FALLBACK_LOG_PATH": root / "chroma" / "librarian-fallback.jsonl",
        "CORTEX_FACT_SUPERSESSION_LOCK_PATH": root / "chroma" / ".fact-supersession.lock",
        "CORTEX_FACT_SUPERSESSION_JOURNAL_DIR": root / "chroma" / ".fact-supersession-journal",
        "CORTEX_L22_STRUCTURED_DB": root / "chroma" / "l22-structured.sqlite3",
        "CORTEX_L22_MEMORY_OPERATION_DB": root / "chroma" / "l22-memory-operations.sqlite3",
        "NEXUS_ASSURANCE_RECEIPT_STATE_PATH": root / "state" / "assurance.sqlite3",
        "NEXUS_CODEC_EVENTS_IDEMPOTENCY_STATE_PATH": root / "state" / "codec.sqlite3",
        "CORTEX_OWNER_MEMORY_RECEIPT_PATH": root / "state" / "owner-index-receipt.json",
        "CORTEX_OWNER_MEMORY_RECEIPT_LOCK_PATH": root / "state" / "owner-index.lock",
        "CORTEX_ENV": "development",
        "LIBRARIAN_LOCAL_FILE_MEMORY_ROOTS": root / "empty-local-memory",
        "LIBRARIAN_SCOPED_LOCAL_FILE_MEMORY_ROOTS": root / "empty-local-memory",
    }
    for key, value in values.items():
        os.environ[key] = str(value)
    (root / "chroma").mkdir(parents=True)
    (root / "state").mkdir(parents=True)
    (root / "empty-local-memory").mkdir(parents=True)


def run_node_bridge_smoke(root: Path) -> dict[str, Any]:
    runner = root / "bridge-smoke.mjs"
    plugin_uri = (ROOT / "plugins" / "cortex-memory-bridge" / "index.ts").resolve().as_uri()
    manager = ROOT / "plugins" / "cortex-memory-bridge" / "manager.mjs"
    spool_root = root / "bridge-state"
    runner.write_text(
        f"""
import assert from 'node:assert/strict';
import {{ createHash }} from 'node:crypto';
import fs from 'node:fs';
import {{
  DurableLifecycleQuota,
  sealLifecyclePayload,
  sealLifecycleReceipt,
  unsealLifecyclePayload,
  unsealLifecycleReceipt,
}} from {json.dumps(plugin_uri)};

const root = {json.dumps(str(spool_root))};
fs.mkdirSync(root, {{ recursive: true, mode: 0o700 }});
const cfg = {{ lifecycleEncryptionKey: 'K'.repeat(64) }};
const namespace = createHash('sha256').update('synthetic-principal').digest('hex');
const principal = {{
  version: 1,
  tenant_id: 'tenant-smoke',
  workspace_id: 'workspace-smoke',
  scope_credential_id: 'credential-smoke',
  agent_id: 'agent-smoke',
  user_id: 'user-smoke',
  channel_id: 'channel-smoke',
  session_id: 'session-smoke',
}};
const key = `${{namespace}}:synthetic-operation`;
const createdAt = '2026-10-02T12:00:00.000Z';
const payload = {{
  version: 1,
  event: {{ result: 'SYNTHETIC-RAW-RESULT', messages: [{{ role: 'user', content: 'SYNTHETIC-RAW-USER' }}] }},
  fallbackText: 'SYNTHETIC-RAW-FALLBACK',
}};
const binding = {{ key, createdAt, principal }};
const sealedPayload = sealLifecyclePayload(cfg, namespace, binding, payload);
const meta = (value) => {{
  const bytes = Buffer.from(value, 'utf8');
  return {{ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }};
}};
const record = {{
  version: 4,
  key,
  createdAt,
  principal,
  event: {{
    result: JSON.stringify({{
      schemaVersion: 'cortex.lifecycle-payload-metadata.v1',
      result: meta(payload.event.result),
      user: meta(payload.event.messages[0].content),
      userMessageCount: 1,
      fallback: meta(payload.fallbackText),
      replayEncrypted: true,
      payloadSha256: sealedPayload.payloadSha256,
    }}),
    messages: [],
  }},
  context: {{
    sessionKey: principal.session_id,
    sessionId: principal.session_id,
    channelId: principal.channel_id,
    agentId: principal.agent_id,
    userId: principal.user_id,
    idempotencyKey: key,
  }},
  fallbackText: '',
  sealedPayload,
}};
const quota = new DurableLifecycleQuota(root, 4);
const spool = quota.spoolForNamespace(namespace);
quota.put(namespace, spool, record);
quota.retainReceipt(namespace, spool, key, 'SYNTHETIC-ASSURANCE-RECEIPT', cfg);
const persisted = quota.entries(namespace, spool)[0];
assert.deepEqual(unsealLifecyclePayload(cfg, namespace, persisted), payload);
assert.equal(unsealLifecycleReceipt(cfg, namespace, persisted), 'SYNTHETIC-ASSURANCE-RECEIPT');
const disk = fs.readFileSync(`${{root}}/${{namespace}}/lifecycle-spool.json`, 'utf8');
for (const forbidden of ['SYNTHETIC-RAW-RESULT', 'SYNTHETIC-RAW-USER', 'SYNTHETIC-RAW-FALLBACK', 'SYNTHETIC-ASSURANCE-RECEIPT']) {{
  assert.equal(disk.includes(forbidden), false);
}}
let tamperRejected = false;
try {{
  unsealLifecyclePayload(cfg, namespace, {{ ...persisted, principal: {{ ...persisted.principal, user_id: 'tampered' }} }});
}} catch {{ tamperRejected = true; }}
assert.equal(tamperRejected, true);
const purged = quota.purgeBefore(namespace, spool, '2026-10-02T12:00:01.000Z');
assert.equal(purged, 1);
assert.equal(fs.existsSync(`${{root}}/${{namespace}}/lifecycle-spool.json`), false);
const directReceipt = sealLifecycleReceipt(cfg, namespace, record, 'SYNTHETIC-DIRECT-RECEIPT');
assert.ok(directReceipt.receiptSha256);
console.log(JSON.stringify({{ encryptedReplay: true, encryptedReceipt: true, tamperRejected, purged }}));
""",
        encoding="utf-8",
    )
    subprocess.run(
        ["node", "--check", str(manager)],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(runner)],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout.strip().splitlines()[-1])


def main() -> int:
    started = datetime.now(timezone.utc)
    checks: dict[str, Any] = {}
    try:
        with tempfile.TemporaryDirectory(prefix="cortex-memory-v6-smoke-") as temporary:
            temp_root = Path(temporary)
            configure_isolated_environment(temp_root)
            sys.path.insert(0, str(SERVER_ROOT))

            python_files = [
                ROOT / "public/cortex_server/cortex_server/runtime/memory_governance.py",
                ROOT / "public/cortex_server/cortex_server/runtime/assurance_receipt_ledger.py",
                ROOT / "public/cortex_server/cortex_server/routers/librarian.py",
                ROOT / "public/cortex_server/cortex_server/routers/knowledge.py",
                ROOT / "public/cortex_server/cortex_server/routers/l22.py",
                ROOT / "scripts/index-owner-memory.py",
                ROOT / "scripts/evaluate-memory-recall.py",
                ROOT / "scripts/review-memory-promotions.py",
                ROOT / "scripts/smoke-memory-lifecycle-v6.py",
            ]
            for path in python_files:
                compile(path.read_text(encoding="utf-8"), str(path), "exec")
            subprocess.run(
                ["git", "diff", "--check"],
                cwd=ROOT,
                check=True,
                text=True,
                capture_output=True,
            )
            checks["python_compile_and_diff_check"] = {
                "passed": True,
                "pythonFiles": len(python_files),
            }

            from cortex_server.construction import read_only_construction

            # Resolve construction-time persistence paths from the isolated
            # environment above. Without an explicit runtime construction
            # context, schema inventory mode deliberately ignores os.environ.
            with read_only_construction(enabled=False):
                from cortex_server.runtime.memory_governance import (
                    MemoryDeletionError,
                    MemoryGovernanceStore,
                    MemorySearchFilters,
                    compile_chroma_where,
                    evaluate_recall,
                    normalize_filterable_metadata,
                    row_matches_filters,
                    temporal_visibility,
                )
                from cortex_server.routers import knowledge, librarian, l22
                from cortex_server.runtime import assurance_receipt_ledger

            knowledge.KnowledgeSearchRequest.model_json_schema()
            l22.L22RecallBenchmarkRequest.model_json_schema()
            l22.L22RecallBenchmarkRequest(
                cases=[{"id": "synthetic-model-case", "query": "Which synthetic fact is current?"}]
            )
            require(callable(assurance_receipt_ledger.delete_assurance_receipts_matching_scope), "receipt deletion API missing")
            checks["router_imports_and_models"] = True

            fixed = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
            temporal_meta = normalize_filterable_metadata(
                {
                    "memory_type": "project_state",
                    "observed_at": fixed.isoformat(),
                    "freshness_ttl_seconds": 60,
                    "source_id": "src-temporal",
                    "path": "fixtures/synthetic/temporal.md",
                    "project": "synthetic-alpha",
                    "memory_status": "active",
                },
                now=fixed,
            )
            require(
                temporal_visibility(temporal_meta, now=fixed + timedelta(seconds=30)).visible,
                "fresh temporal record was hidden",
            )
            require(
                not temporal_visibility(temporal_meta, now=fixed + timedelta(seconds=120)).visible,
                "stale temporal record remained visible by default",
            )
            require(
                temporal_visibility(
                    temporal_meta, now=fixed + timedelta(seconds=120), include_stale=True
                ).visible,
                "explicit stale inclusion failed",
            )
            filters = MemorySearchFilters.from_mapping(
                {
                    "source_paths": ["fixtures/synthetic/temporal.md"],
                    "projects": ["synthetic-alpha"],
                    "statuses": ["active"],
                    "as_of": (fixed + timedelta(seconds=30)).isoformat(),
                    "as_known_at": (fixed + timedelta(seconds=30)).isoformat(),
                    "include_stale": False,
                    "include_unknown_time": False,
                }
            )
            where = compile_chroma_where({"memory_principal_key": "principal-smoke"}, filters)
            where_json = json.dumps(where, sort_keys=True)
            for token in (
                "memory_principal_key",
                "path",
                "project",
                "known_at_epoch",
                "valid_from_epoch",
                "valid_until_epoch",
                "stale_after_epoch",
            ):
                require(token in where_json, f"pre-ranking filter omitted {token}")
            require(row_matches_filters(temporal_meta, filters), "post-ranking filter rejected matching row")
            checks["temporal_and_pre_ranking_filters"] = True

            governance = MemoryGovernanceStore()
            secret = "api_key=sk-SYNTHETICSECRET123456789"
            admission = governance.admit(
                "principal-smoke", secret, {"source": "synthetic-smoke"}, observed_at=fixed
            )
            require(not admission.allowed and admission.action == "quarantine_hash_only", "sensitive payload was admitted")
            for candidate in (temp_root / "chroma").glob("memory-governance.sqlite3*"):
                require(secret.encode("utf-8") not in candidate.read_bytes(), "quarantine retained raw sensitive payload")
            checks["privacy_hash_only_quarantine"] = True

            fresh_base = {
                "observed_at": fixed.isoformat(),
                "last_verified_at": fixed.isoformat(),
                "stale_after": (fixed + timedelta(days=365)).isoformat(),
                "memory_status": "active",
            }
            low = governance.record_fact(
                principal_key="principal-smoke",
                memory_id="memory-low",
                content="synthetic legacy mode",
                metadata={
                    **fresh_base,
                    "claim_key": "claim-synthetic-mode",
                    "fact_key": "fact-synthetic-mode-low",
                    "fact_value": "legacy",
                    "source_id": "source-low",
                    "authority_rank": 10,
                },
            )
            high = governance.record_fact(
                principal_key="principal-smoke",
                memory_id="memory-high",
                content="synthetic current mode",
                metadata={
                    **fresh_base,
                    "claim_key": "claim-synthetic-mode",
                    "fact_key": "fact-synthetic-mode-high",
                    "fact_value": "current",
                    "source_id": "source-high",
                    "authority_rank": 90,
                },
            )
            require(low is not None and high is not None, "fact projection was not created")
            require(high.active_winner_id == "memory-high" and high.edge_ids, "contradiction winner/edge was not deterministic")
            conflicts = governance.conflict_projection(
                principal_key="principal-smoke", memory_ids=["memory-low", "memory-high"]
            )
            require(conflicts["memory-low"]["fact_status"] == "conflicted", "losing fact was not conflicted")
            require(conflicts["memory-high"]["fact_status"] == "active", "winning fact was not active")

            promotion_common = {
                **fresh_base,
                "claim_key": "claim-synthetic-promotion",
                "fact_value": "verified-value",
                "candidate_fact": True,
                "required_evidence_count": 2,
                "confidence": 0.95,
            }
            governance.record_fact(
                principal_key="principal-smoke",
                memory_id="promotion-evidence-a",
                content="synthetic verified value",
                metadata={
                    **promotion_common,
                    "fact_key": "fact-synthetic-promotion-a",
                    "source_id": "source-evidence-a",
                },
            )
            governance.record_fact(
                principal_key="principal-smoke",
                memory_id="promotion-evidence-b",
                content="synthetic verified value",
                metadata={
                    **promotion_common,
                    "fact_key": "fact-synthetic-promotion-b",
                    "source_id": "source-evidence-b",
                },
            )
            queued = governance.enqueue_promotion(
                principal_key="principal-smoke",
                memory_id="promotion-evidence-b",
                metadata=promotion_common,
                classification="private",
            )
            require(queued["status"] == "pending_review", "independently evidenced promotion was not review-gated")
            reviewed = governance.review_promotion(
                principal_key="principal-smoke",
                memory_id="promotion-evidence-b",
                approved=True,
                reviewer="operator-smoke",
            )
            require(reviewed["status"] == "approved", "operator approval was not recorded")
            governance.mark_promoted(
                principal_key="principal-smoke", memory_id="promotion-evidence-b"
            )
            checks["fact_edges_and_review_gated_promotion"] = True

            payload_hash = hashlib.sha256(b"synthetic-outbox-payload").hexdigest()
            observed = (fixed - timedelta(seconds=1)).isoformat()
            staged = governance.stage_outbox(
                principal_key="principal-smoke",
                operation_id="operation-smoke",
                payload_hash=payload_hash,
                observed_at=observed,
            )
            require(staged["state"] == "pending", "outbox did not stage")
            committed = governance.commit_outbox(
                principal_key="principal-smoke",
                operation_id="operation-smoke",
                payload_hash=payload_hash,
                receipt_id="receipt-smoke",
            )
            require(committed["state"] == "committed", "outbox did not commit")
            replay = governance.stage_outbox(
                principal_key="principal-smoke",
                operation_id="operation-smoke",
                payload_hash=payload_hash,
                observed_at=observed,
                receipt_id="receipt-smoke",
            )
            require(replay["state"] == "committed", "idempotent outbox replay lost commit state")
            checks["server_outbox_idempotency"] = True

            indexer = load_module("cortex_owner_indexer_smoke", ROOT / "scripts/index-owner-memory.py")
            owner_root = temp_root / "owner"
            owner_root.mkdir()
            source = owner_root / "USER.md"
            source.write_text("# Alpha\nAlpha fact.\n\n# Beta\nBeta fact.\n", encoding="utf-8")
            policy = [indexer.SourcePolicy(path="USER.md", kind="user_profile", classification="owner_non_phi")]
            first, _ = indexer.collect_desired(owner_root, policy, scope_digest="scope-smoke")
            source.write_text("# Inserted\nInserted fact.\n\n# Alpha\nAlpha fact.\n\n# Beta\nBeta fact.\n", encoding="utf-8")
            second, _ = indexer.collect_desired(owner_root, policy, scope_digest="scope-smoke")
            common_texts = {entry.text for entry in first.values()} & {entry.text for entry in second.values()}
            first_ids = {entry.text: entry.chunk_id for entry in first.values()}
            second_ids = {entry.text: entry.chunk_id for entry in second.values()}
            require(common_texts and all(first_ids[text] == second_ids[text] for text in common_texts), "earlier insertion churned stable chunk IDs")
            entry = next(iter(second.values()))

            class SemanticClient:
                def __init__(self, exact: bool) -> None:
                    self.exact = exact
                    self.verified = False

                def read(self, _memory_id):
                    return {"id": "target-memory", "text": entry.text, "metadata": indexer._entry_metadata(entry)}

                def search(self, _query, **_kwargs):
                    memory_id = "target-memory" if self.exact else "sibling-memory"
                    return {
                        "available": True,
                        "mode": "semantic",
                        "degraded": False,
                        "warning": None,
                        "results": [{
                            "id": memory_id,
                            "text": entry.text,
                            "metadata": indexer._entry_metadata(entry),
                        }],
                    }

                def mark_verified(self, _memory_id, **_kwargs):
                    self.verified = True

            rejected_sibling = False
            try:
                indexer.verify_entry(SemanticClient(False), entry, "target-memory")
            except indexer.BackendError as exc:
                rejected_sibling = exc.code == "semantic_exact_chunk_missing"
            require(rejected_sibling, "sibling-only semantic evidence received exact-ID credit")
            exact_client = SemanticClient(True)
            indexer.verify_entry(exact_client, entry, "target-memory")
            require(exact_client.verified, "exact semantic verification was not finalized")
            checks["stable_ids_and_exact_semantic_verification"] = True

            evaluation_module = load_module(
                "cortex_recall_evaluator_smoke", ROOT / "scripts/evaluate-memory-recall.py"
            )
            actual_fixture = evaluation_module._load_cases(
                ROOT / "public/cortex_server/benchmarks/owner-memory-recall-v1.json"
            )
            synthetic_cases = evaluation_module._load_cases(
                ROOT / "public/cortex_server/benchmarks/owner-memory-recall-synthetic-v1.json"
            )
            require(len(actual_fixture) >= 5 and len(synthetic_cases) >= 5, "recall corpus is incomplete")
            synthetic_results: dict[str, list[dict[str, Any]]] = {}
            for case in synthetic_cases:
                metadata = {
                    "fact_key": (case.get("expected_fact_keys") or [f"fact-{case['id']}"])[0],
                    "source_id": (case.get("expected_source_ids") or [f"source-{case['id']}"])[0],
                    "path": (case.get("expected_source_paths") or [f"fixtures/synthetic/{case['id']}.md"])[0],
                    "project": ((case.get("filters") or {}).get("projects") or ["synthetic-project"])[0],
                    "freshness_state": "fresh",
                    "memory_status": "active",
                }
                synthetic_results[case["id"]] = [{
                    "id": case.get("expected_winner_id") or f"memory-{case['id']}",
                    "metadata": metadata,
                    "selected_answer": bool(case.get("expected_winner_id") or case.get("expected_winner_fact_key")),
                }]
            metrics = evaluate_recall(synthetic_cases, synthetic_results)
            require(metrics.answer_recall_at_k == 1.0, "recall metric did not detect all expected answers")
            require(metrics.source_recall_at_k == 1.0, "source recall metric was not exact")
            require(metrics.leakage_rate == 0.0, "leakage metric missed isolation")
            require(metrics.stale_answer_error_rate == 0.0, "fresh fixture produced stale-answer errors")
            require(metrics.contradiction_winner_accuracy == 1.0, "contradiction winner metric failed")
            checks["bounded_recall_metrics"] = metrics.as_dict()

            target_metadata = {
                "tenant_id": "tenant-smoke",
                "storage_workspace_id": "workspace-smoke",
                "memory_principal_key": "principal-smoke",
                "memory_status": "active",
            }
            foreign_metadata = {
                "tenant_id": "tenant-foreign",
                "storage_workspace_id": "workspace-foreign",
                "memory_principal_key": "principal-foreign",
                "memory_status": "active",
            }
            fake = FakeCollection({
                "semantic-target": {"document": "synthetic target", "metadata": target_metadata},
                "semantic-foreign": {"document": "synthetic foreign", "metadata": foreign_metadata},
            })
            librarian.collection = fake
            fallback_path = Path(os.environ["LIBRARIAN_FALLBACK_LOG_PATH"])
            fallback_path.parent.mkdir(parents=True, exist_ok=True)
            fallback_path.write_text(
                json.dumps({"id": "fallback-target", "metadata": target_metadata}) + "\n"
                + json.dumps({"id": "fallback-foreign", "metadata": foreign_metadata}) + "\n",
                encoding="utf-8",
            )
            source_of_record = temp_root / "owner-source-preserved.md"
            source_of_record.write_text("synthetic owner source", encoding="utf-8")
            principal = SimpleNamespace(
                tenant_id="tenant-smoke",
                storage_workspace_id="workspace-smoke",
                memory_principal_key="principal-smoke",
                credential_id="credential-smoke",
                scope={
                    "tenant_id": "tenant-smoke",
                    "workspace_id": "workspace-smoke",
                    "agent_id": "agent-smoke",
                    "user_id": "user-smoke",
                    "channel_id": "channel-smoke",
                    "session_id": "session-smoke",
                },
            )
            deletion = l22._hard_delete_principal_memory(principal)
            require(deletion["completed"] is True, "principal deletion did not converge")
            require("semantic-target" not in fake.records and "semantic-foreign" in fake.records, "principal semantic deletion crossed or missed scope")
            fallback_rows = [json.loads(line) for line in fallback_path.read_text(encoding="utf-8").splitlines()]
            require([row["id"] for row in fallback_rows] == ["fallback-foreign"], "fallback deletion crossed or missed scope")
            require(source_of_record.exists(), "principal deletion removed an owner source file")
            old_replay_blocked = False
            try:
                governance.stage_outbox(
                    principal_key="principal-smoke",
                    operation_id="operation-after-delete",
                    payload_hash=payload_hash,
                    observed_at=observed,
                )
            except MemoryDeletionError:
                old_replay_blocked = True
            require(old_replay_blocked, "deletion fence allowed a pre-deletion replay")
            require(
                not governance.conflict_projection(
                    principal_key="principal-smoke", memory_ids=["memory-low", "memory-high"]
                ),
                "governance facts survived principal deletion",
            )
            require(
                governance.list_promotions(principal_key="principal-smoke") == [],
                "promotion state survived principal deletion",
            )
            checks["principal_hard_delete_and_replay_fence"] = {
                "completed": True,
                "semanticDeleted": deletion["counts"].get("semantic_records"),
                "fallbackDeleted": deletion["counts"].get("fallback_rows"),
                "sourceFilesPreserved": True,
                "oldReplayBlocked": old_replay_blocked,
            }

            manifest = json.loads(
                (ROOT / "plugins/cortex-memory-bridge/openclaw.plugin.json").read_text(encoding="utf-8")
            )
            require(
                "memory_delete_principal" in manifest["contracts"]["tools"],
                "bridge manifest omitted principal deletion tool",
            )
            require(
                "lifecycleEncryptionKey" in manifest["configSchema"]["properties"],
                "bridge manifest omitted encryption-key schema",
            )
            checks["bridge_manifest"] = True
            checks["encrypted_restart_replay"] = run_node_bridge_smoke(temp_root)

        completed = datetime.now(timezone.utc)
        artifact = {
            "schemaVersion": "cortex.memory-lifecycle-v6.smoke.v1",
            "status": "passed",
            "startedAt": started.isoformat(),
            "completedAt": completed.isoformat(),
            "durationSeconds": round((completed - started).total_seconds(), 3),
            "worktree": str(ROOT),
            "checks": checks,
            "truthBoundary": "One isolated mechanical smoke; not a broad regression, soak, production-health, or empirical owner-recall-quality claim.",
        }
        atomic_json(ARTIFACT, artifact)
        print(json.dumps(artifact, sort_keys=True))
        return 0
    except Exception as exc:
        completed = datetime.now(timezone.utc)
        artifact = {
            "schemaVersion": "cortex.memory-lifecycle-v6.smoke.v1",
            "status": "failed",
            "startedAt": started.isoformat(),
            "completedAt": completed.isoformat(),
            "durationSeconds": round((completed - started).total_seconds(), 3),
            "worktree": str(ROOT),
            "checks": checks,
            "failure": {"type": type(exc).__name__, "message": str(exc)},
            "truthBoundary": "The only approved smoke failed; release remains blocked and no rerun is implied.",
        }
        atomic_json(ARTIFACT, artifact)
        print(json.dumps(artifact, sort_keys=True), file=sys.stderr)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
