from pathlib import Path

from cortex_server.modules.execution_transaction import ExecutionTransaction, RetryPolicy, TransactionStepError


def test_execution_transaction_retries_and_journals(tmp_path: Path):
    calls = {"n": 0}

    tx = ExecutionTransaction(tx_id="tx-retry", tx_type="fastlane", journal_dir=tmp_path)
    tx.preflight({"query_present": lambda: {"ok": True}})

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return {"value": 42}

    out = tx.run_step("retrieve", flaky, retry_policy=RetryPolicy.for_kind("transient_io"), verify=lambda x: x["value"] == 42)
    assert out["value"] == 42
    final = tx.finalize({"answer": "ok"}, verify=lambda payload: payload["answer"] == "ok")
    assert final["status"] == "completed"
    assert (tmp_path / "tx-retry.json").exists()


def test_execution_transaction_rolls_up_failure(tmp_path: Path):
    tx = ExecutionTransaction(tx_id="tx-fail", tx_type="fastlane", journal_dir=tmp_path)
    tx.preflight({"query_present": lambda: {"ok": True}})

    try:
        tx.run_step("bad", lambda: (_ for _ in ()).throw(RuntimeError("boom")), retry_policy=RetryPolicy.for_kind("no_retry"))
    except TransactionStepError:
        failed = tx.fail(RuntimeError("boom"))
        assert failed["status"] == "failed"
    else:
        raise AssertionError("expected failure")
