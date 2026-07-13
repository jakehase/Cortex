from cortex_server import worker


def test_worker_builds_configured_write_authorization_header(monkeypatch):
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "worker-secret")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN_HEADER", "x-worker-token")

    assert worker._cortex_write_headers() == {"x-worker-token": "worker-secret"}


def test_worker_omits_authorization_when_no_token_is_configured(monkeypatch):
    monkeypatch.delenv("CORTEX_WRITE_TOKEN", raising=False)
    monkeypatch.setenv("CORTEX_WRITE_TOKEN_HEADER", "x-worker-token")

    assert worker._cortex_write_headers() == {}
