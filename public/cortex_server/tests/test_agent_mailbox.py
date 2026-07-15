from __future__ import annotations

import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pytest

from cortex_server.runtime import AgentMailbox, AgentMessage
from cortex_server.runtime.agent_mailbox import ValidationError, agent_acknowledgement_signature



def test_agent_message_validation_defaults():
    message = AgentMessage(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        payload={"objective": "Investigate"},
    )

    assert message.message_id.startswith("msg_")
    assert message.delivery_status == "queued"
    assert message.attempt_count == 0
    assert message.created_at.endswith("Z")



def test_agent_message_rejects_invalid_values():
    with pytest.raises(ValidationError):
        AgentMessage(process_id="", from_agent="coordinator", to_agent="researcher")

    with pytest.raises(ValidationError):
        AgentMessage(process_id="proc_123", from_agent="coordinator", to_agent="researcher", attempt_count=-1)



def test_agent_mailbox_send_receive_ack_retry_and_dead_letter(tmp_path: Path):
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")

    sent = mailbox.send(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        kind="handoff",
        payload={"objective": "Investigate"},
        revision_id="rev_1",
    )

    queued = mailbox.list(process_id="proc_123", to_agent="researcher", delivery_statuses=["queued"])
    assert len(queued) == 1
    assert queued[0].message_id == sent.message_id

    inflight = mailbox.receive(to_agent="researcher", process_id="proc_123")
    assert len(inflight) == 1
    assert inflight[0].delivery_status == "inflight"
    assert inflight[0].attempt_count == 1

    acked = mailbox.acknowledge(sent.message_id, actor="researcher")
    assert acked.delivery_status == "acked"
    assert acked.acked_at is not None

    retried = mailbox.retry(sent.message_id)
    assert retried.delivery_status == "queued"

    dead = mailbox.dead_letter(sent.message_id)
    assert dead.delivery_status == "dead_letter"
    assert dead.dead_lettered_at is not None



def test_agent_mailbox_missing_message_raises(tmp_path: Path):
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")
    with pytest.raises(KeyError):
        mailbox.acknowledge("msg_missing", actor="researcher")



def test_agent_mailbox_rejects_stale_revision_on_receive(tmp_path: Path):
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")

    sent = mailbox.send(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        kind="handoff",
        payload={"objective": "Investigate"},
        revision_id="rev_1",
    )

    accepted = mailbox.receive(
        to_agent="researcher",
        process_id="proc_123",
        expected_revision_id="rev_2",
        reject_stale_revision=True,
    )
    stored = mailbox.list(process_id="proc_123", to_agent="researcher")

    assert accepted == []
    assert len(stored) == 1
    assert stored[0].message_id == sent.message_id
    assert stored[0].delivery_status == "dead_letter"
    assert stored[0].metadata["rejection_reason"] == "stale_revision"
    assert stored[0].metadata["expected_revision_id"] == "rev_2"
    assert stored[0].metadata["observed_revision_id"] == "rev_1"



def test_agent_mailbox_send_dedupes_by_dedupe_key(tmp_path: Path):
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")

    first = mailbox.send(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        kind="handoff",
        dedupe_key="handoff:step1:rev2",
        payload={"objective": "Investigate"},
    )
    second = mailbox.send(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        kind="handoff",
        dedupe_key="handoff:step1:rev2",
        payload={"objective": "Investigate again"},
    )

    assert first.message_id == second.message_id
    assert len(mailbox.list(process_id="proc_123", to_agent="researcher")) == 1



def test_agent_mailbox_can_recover_dead_letters(tmp_path: Path):
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")

    sent = mailbox.send(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        kind="handoff",
        revision_id="rev_1",
        payload={"objective": "Investigate"},
    )
    mailbox.dead_letter(sent.message_id)

    recovered = mailbox.recover_dead_letter(sent.message_id, revision_id="rev_2", recovery_reason="align_revision")

    assert recovered.delivery_status == "queued"
    assert recovered.revision_id == "rev_2"
    assert recovered.metadata["recovered_from_status"] == "dead_letter"
    assert recovered.metadata["recovery_reason"] == "align_revision"
    assert recovered.metadata["recovery_count"] == 1


def test_agent_mailbox_serializes_concurrent_read_modify_write_transactions(tmp_path: Path):
    path = tmp_path / "runtime" / "mailbox.json"

    def send(index: int):
        return AgentMailbox(path).send(
            process_id="proc_concurrent",
            from_agent="coordinator",
            to_agent="release-verifier",
            dedupe_key=f"message:{index}",
            payload={"index": index},
        )

    with ThreadPoolExecutor(max_workers=12) as executor:
        message_ids = {row.message_id for row in executor.map(send, range(50))}

    mailbox = AgentMailbox(path)
    assert len(message_ids) == 50
    assert len(mailbox.list(process_id="proc_concurrent")) == 50


def test_claim_payload_is_persisted_before_recipient_ack_signature(tmp_path: Path, monkeypatch):
    secret = "release-recipient-secret-00000000000001"
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps({"release-verifier": secret}),
    )
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")
    sent = mailbox.send(
        process_id="proc_release",
        from_agent="controller",
        to_agent="release-verifier",
        revision_id="rev_2",
        payload={"artifact_receipts": []},
        metadata={
            "target_stage": "canary_verified",
            "candidate_ref": "candidate-2",
            "release_id": "release-2",
        },
    )
    mailbox.receive(to_agent="release-verifier", process_id="proc_release")
    bound = mailbox.bind_claim_payload(
        sent.message_id,
        expected_revision_id="rev_2",
        payload={"artifact_receipts": [{"artifact_id": "evidence:canary_verified"}]},
    )
    receipt = {
        "result": "approved",
        "candidate_ref": "candidate-2",
        "release_id": "release-2",
        "revision_id": "rev_2",
        "evidence_receipts": ["evidence:canary_verified"],
    }
    signature = agent_acknowledgement_signature(
        bound,
        actor="release-verifier",
        result_receipt=receipt,
        secret=secret,
    )

    acknowledged = mailbox.acknowledge(
        sent.message_id,
        actor="release-verifier",
        result_receipt=receipt,
        actor_signature=signature,
    )

    assert acknowledged.delivery_status == "acked"
    assert acknowledged.payload == bound.payload
    assert mailbox.list(process_id="proc_release")[0].payload == bound.payload
