from cortex_server.modules.qa_fastlane import classify_qtype, confidence_score, should_escalate
from cortex_server.modules.qa_micro_retrieval import retrieve_top3


def test_qtype_classification():
    assert classify_qtype("How to install nginx?") == "procedural"
    assert classify_qtype("Python vs Go for APIs") == "comparative"
    assert classify_qtype("Why is the sky blue?") == "explanatory"


def test_confidence_and_escalation():
    checks = {"required_fields_ok": True, "contradiction_detected": False, "overclaim_detected": False, "retrieval_hits": 2}
    conf = confidence_score("This is a sufficiently detailed answer with useful structure.", checks)
    assert conf >= 0.72
    assert should_escalate(conf, [], threshold=0.72) is False
    assert should_escalate(0.3, [], threshold=0.72) is True


def test_retrieval_top3_cap():
    out = retrieve_top3("test query", max_items=10, timeout_ms=500)
    assert len(out) <= 3
