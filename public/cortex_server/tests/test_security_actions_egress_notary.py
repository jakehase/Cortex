from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server import outbound_egress
from cortex_server.middleware.error_handler import _safe_http_detail
from cortex_server.outbound_egress import (
    EgressPolicy,
    EgressPolicyError,
    EgressResponse,
    EgressResponseTooLarge,
)
from cortex_server.modules.sensitive_data_redaction import (
    redact_headers,
    redact_sensitive_data,
)
from cortex_server.modules.consciousness_core import ConsciousnessCore
from cortex_server.modules.consciousness_integration import _safe_summary
from cortex_server.routers import browser, diplomat, parsers, sentinel


def _dns_answer(address: str, port: int = 443):
    family = (
        outbound_egress.socket.AF_INET6
        if ":" in address
        else outbound_egress.socket.AF_INET
    )
    return (family, outbound_egress.socket.SOCK_STREAM, 6, "", (address, port))


@pytest.fixture(autouse=True)
def _isolate_security_configuration(monkeypatch):
    for name in (
        "CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS",
        "CORTEX_DIPLOMAT_EGRESS_ALLOWED_HOSTS",
        "CORTEX_PARSER_EGRESS_ALLOWED_HOSTS",
        "CORTEX_SENTINEL_EGRESS_ALLOWED_HOSTS",
        "L2_NOTARY_SECRET",
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    browser._cache.clear()


def test_capability_policies_are_server_owned_specific_and_default_deny(monkeypatch):
    monkeypatch.setenv(
        "CORTEX_DIPLOMAT_EGRESS_ALLOWED_HOSTS",
        "api.example.com,*.hooks.example.com",
    )

    diplomat_policy = EgressPolicy.from_environment("diplomat")
    browser_policy = EgressPolicy.from_environment("browser")

    assert diplomat_policy.permits_hostname("api.example.com") is True
    assert diplomat_policy.permits_hostname("tenant.hooks.example.com") is True
    assert diplomat_policy.permits_hostname("hooks.example.com") is False
    assert browser_policy.permits_hostname("api.example.com") is False


def test_consciousness_trace_redacts_input_error_and_phi_before_persistence(tmp_path):
    bearer = "opaque-consciousness-bearer-value"
    patient_email = "patient@example.test"
    core = ConsciousnessCore(state_dir=tmp_path / "consciousness")

    summary = _safe_summary(
        {
            "authorization": f"Bearer {bearer}",
            "diagnostic": f"token: Bearer {bearer}",
            "patient_email": patient_email,
        }
    )
    core._think_sync("security-test", {"type": "error", "payload": summary})

    retained = json.dumps(
        {
            "memory": core.mind_state,
            "stream": core.thought_stream.read_text(encoding="utf-8"),
        }
    )
    assert bearer not in retained
    assert patient_email not in retained
    assert "[REDACTED]" in retained


@pytest.mark.asyncio
async def test_destination_validation_pins_public_address_and_rejects_any_private_answer(
    monkeypatch,
):
    policy = EgressPolicy("test", ("public.example",))

    def public_answers(hostname, port, *_args):
        assert hostname == "public.example"
        return [_dns_answer("8.8.8.8", port), _dns_answer("1.1.1.1", port)]

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", public_answers)
    destination = await outbound_egress.validate_destination(
        "https://public.example:8443/a?q=1#ignored",
        policy,
    )
    assert destination.pinned_url == "https://8.8.8.8:8443/a?q=1"
    assert destination.host_header == "public.example:8443"
    assert destination.sni_hostname == "public.example"

    def mixed_answers(_hostname, port, *_args):
        return [_dns_answer("8.8.8.8", port), _dns_answer("169.254.169.254", port)]

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", mixed_answers)
    with pytest.raises(EgressPolicyError, match="non-global"):
        await outbound_egress.validate_destination(
            "https://public.example/private-rebind",
            policy,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    (
        "http://127.0.0.1/admin",
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.2/internal",
        "file:///etc/passwd",
        "ftp://public.example/file",
        "https://user:secret@public.example/path",
    ),
)
async def test_destination_validation_rejects_local_and_non_http_targets(
    monkeypatch,
    url,
):
    policy = EgressPolicy(
        "test",
        ("127.0.0.1", "169.254.169.254", "10.0.0.2", "public.example"),
    )

    def answers(hostname, port, *_args):
        return [_dns_answer(hostname, port)]

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", answers)
    with pytest.raises(EgressPolicyError):
        await outbound_egress.validate_destination(url, policy)


class _FakeResponse:
    def __init__(self, status_code, *, headers=None, chunks=(), chunk_delay=0.0):
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = tuple(chunks)
        self._chunk_delay = float(chunk_delay)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def aiter_bytes(self):
        for chunk in self._chunks:
            if self._chunk_delay:
                await asyncio.sleep(self._chunk_delay)
            yield chunk


class _FakeAsyncClient:
    responses = []
    init_kwargs = []
    calls = []

    def __init__(self, **kwargs):
        type(self).init_kwargs.append(kwargs)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def stream(self, method, url, **kwargs):
        type(self).calls.append((method, url, kwargs))
        return type(self).responses.pop(0)


@pytest.mark.asyncio
async def test_broker_disables_environment_proxy_and_revalidates_redirect_dns(monkeypatch):
    _FakeAsyncClient.responses = [
        _FakeResponse(302, headers={"location": "http://metadata.example/latest"}),
    ]
    _FakeAsyncClient.init_kwargs = []
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(outbound_egress.httpx, "AsyncClient", _FakeAsyncClient)

    def answers(hostname, port, *_args):
        address = "8.8.8.8" if hostname == "origin.example" else "169.254.169.254"
        return [_dns_answer(address, port)]

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", answers)
    policy = EgressPolicy("test", ("origin.example", "metadata.example"))

    with pytest.raises(EgressPolicyError, match="non-global"):
        await outbound_egress.request(
            "GET",
            "https://origin.example/start",
            policy=policy,
        )

    assert _FakeAsyncClient.init_kwargs[0]["trust_env"] is False
    assert _FakeAsyncClient.init_kwargs[0]["follow_redirects"] is False
    assert len(_FakeAsyncClient.calls) == 1
    assert _FakeAsyncClient.calls[0][1] == "https://8.8.8.8/start"
    assert _FakeAsyncClient.calls[0][2]["headers"]["Host"] == "origin.example"


@pytest.mark.asyncio
async def test_broker_strips_all_caller_headers_on_cross_origin_redirect(monkeypatch):
    _FakeAsyncClient.responses = [
        _FakeResponse(302, headers={"location": "https://redirect.example/next"}),
        _FakeResponse(200, chunks=(b"ok",)),
    ]
    _FakeAsyncClient.init_kwargs = []
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(outbound_egress.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        outbound_egress.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("8.8.8.8", port)],
    )

    await outbound_egress.request(
        "GET",
        "https://origin.example/start",
        policy=EgressPolicy("test", ("origin.example", "redirect.example")),
        headers={
            "Authorization": "Bearer origin-secret",
            "Cookie": "session=origin-secret",
            "X-Api-Key": "api-key-secret",
            "X-Cortex-Write-Token": "write-token-secret",
            "X-Cortex-Scope-Signature": "scope-signature-secret",
            "X-Trace-Id": "safe-trace",
            "X-Private-Context": "opaque-unlabelled-secret",
        },
    )

    redirected_headers = {
        key.lower(): value for key, value in _FakeAsyncClient.calls[1][2]["headers"].items()
    }
    assert redirected_headers["host"] == "redirect.example"
    for name in (
        "authorization",
        "cookie",
        "x-api-key",
        "x-cortex-write-token",
        "x-cortex-scope-signature",
        "x-trace-id",
        "x-private-context",
    ):
        assert name not in redirected_headers


@pytest.mark.asyncio
async def test_broker_rejects_cross_origin_redirect_that_preserves_payload(monkeypatch):
    _FakeAsyncClient.responses = [
        _FakeResponse(307, headers={"location": "https://redirect.example/sink"}),
    ]
    _FakeAsyncClient.init_kwargs = []
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(outbound_egress.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        outbound_egress.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("8.8.8.8", port)],
    )

    with pytest.raises(EgressPolicyError, match="cross-origin redirect"):
        await outbound_egress.request(
            "POST",
            "https://origin.example/start",
            policy=EgressPolicy("test", ("origin.example", "redirect.example")),
            json={"opaque": "caller-approved-only-for-origin"},
        )

    assert len(_FakeAsyncClient.calls) == 1


@pytest.mark.asyncio
async def test_broker_applies_one_absolute_deadline_to_slow_stream(monkeypatch):
    _FakeAsyncClient.responses = [
        _FakeResponse(200, chunks=(b"one", b"two"), chunk_delay=0.02),
    ]
    _FakeAsyncClient.init_kwargs = []
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(outbound_egress.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        outbound_egress.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("8.8.8.8", port)],
    )

    with pytest.raises(outbound_egress.EgressUpstreamError, match="timed out"):
        await outbound_egress.request(
            "GET",
            "https://public.example/data",
            policy=EgressPolicy("test", ("public.example",)),
            timeout=0.01,
        )


@pytest.mark.asyncio
async def test_broker_streams_under_a_hard_response_limit(monkeypatch):
    _FakeAsyncClient.responses = [
        _FakeResponse(200, chunks=(b"1234", b"5678")),
    ]
    _FakeAsyncClient.init_kwargs = []
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(outbound_egress.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(
        outbound_egress.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("8.8.8.8", port)],
    )

    with pytest.raises(EgressResponseTooLarge):
        await outbound_egress.request(
            "GET",
            "https://public.example/data",
            policy=EgressPolicy("test", ("public.example",)),
            max_response_bytes=6,
        )


class _FakeBrowserRequest:
    def __init__(self, url: str, *, navigation: bool):
        self.url = url
        self._navigation = navigation

    def is_navigation_request(self):
        return self._navigation


class _FakeRoute:
    def __init__(self, url: str, *, navigation: bool):
        self.request = _FakeBrowserRequest(url, navigation=navigation)
        self.continued = False
        self.aborted = None

    async def continue_(self):
        self.continued = True

    async def abort(self, reason):
        self.aborted = reason


class _FakeWebSocketRoute:
    closed = None

    async def close(self, **kwargs):
        self.closed = kwargs


class _FakeBrowserContext:
    route_handler = None
    websocket_handler = None

    async def route(self, _pattern, handler):
        self.route_handler = handler

    async def route_web_socket(self, _pattern, handler):
        self.websocket_handler = handler


@pytest.mark.asyncio
async def test_playwright_offline_renderer_blocks_all_network_and_websockets(
    monkeypatch,
):
    def answers(hostname, port, *_args):
        address = "8.8.8.8" if hostname == "safe.example" else "127.0.0.1"
        return [_dns_answer(address, port)]

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", answers)
    context = _FakeBrowserContext()
    policy = EgressPolicy("browser", ("safe.example", "internal.example"))
    await browser._install_browser_egress_guard(context, policy=policy)

    allowed = _FakeRoute("https://safe.example/app.js", navigation=False)
    await context.route_handler(allowed)
    assert allowed.continued is False
    assert allowed.aborted == "blockedbyclient"

    blocked_subresource = _FakeRoute(
        "http://internal.example/private",
        navigation=False,
    )
    await context.route_handler(blocked_subresource)
    assert blocked_subresource.continued is False
    assert blocked_subresource.aborted == "blockedbyclient"

    blocked_redirect = _FakeRoute(
        "http://internal.example/redirected",
        navigation=True,
    )
    await context.route_handler(blocked_redirect)
    assert blocked_redirect.aborted == "blockedbyclient"

    websocket = _FakeWebSocketRoute()
    await context.websocket_handler(websocket)
    assert websocket.closed == {"code": 1008, "reason": "outbound policy"}


@pytest.mark.asyncio
async def test_caller_domain_cannot_expand_browser_server_policy(monkeypatch):
    called = False

    def unexpected_dns(*_args):
        nonlocal called
        called = True
        raise AssertionError("unlisted hosts must be rejected before DNS")

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", unexpected_dns)
    with pytest.raises(EgressPolicyError, match="server-authorized"):
        await browser._validate_browser_destination(
            "https://caller-only.example/path",
            policy=EgressPolicy("browser", ("server.example",)),
            allowed_domains=["caller-only.example"],
        )
    assert called is False


@pytest.mark.asyncio
async def test_parser_hostname_allowlist_is_server_owned_and_checked_before_dns(monkeypatch):
    called = False

    def unexpected_dns(*_args):
        nonlocal called
        called = True
        raise AssertionError("unlisted parser hosts must be rejected before DNS")

    monkeypatch.setattr(parsers.socket, "getaddrinfo", unexpected_dns)
    with pytest.raises(parsers._ExtractPolicyError, match="server-authorized"):
        await parsers._public_http_url("https://caller-only.example/document")
    assert called is False

    monkeypatch.setenv(
        "CORTEX_PARSER_EGRESS_ALLOWED_HOSTS",
        "documents.example",
    )
    monkeypatch.setattr(
        parsers.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("8.8.8.8", port)],
    )
    destination = await parsers._public_http_url(
        "https://documents.example/report",
    )
    assert destination.url == "https://8.8.8.8/report"
    assert destination.host_header == "documents.example"


@pytest.mark.asyncio
async def test_browser_revalidates_destination_before_serving_cached_content(monkeypatch):
    monkeypatch.setenv(
        "CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS",
        "169.254.169.254",
    )
    url = "http://169.254.169.254/latest/meta-data"
    browser._cache[browser._cache_key(url, "browse")] = {
        "data": "cached secret",
        "stored": browser.datetime.now(),
    }

    with pytest.raises(EgressPolicyError, match="non-global"):
        await browser._fetch_page_text(url)


@pytest.mark.asyncio
async def test_browser_radar_rejects_target_before_persisting_watch(monkeypatch):
    async def reject_destination(*_args, **_kwargs):
        raise EgressPolicyError("destination hostname is not server-authorized")

    persisted = []
    monkeypatch.setattr(browser, "assert_action_authorized", lambda _value: None)
    monkeypatch.setattr(browser, "_validate_browser_destination", reject_destination)
    monkeypatch.setattr(
        browser,
        "_write_json",
        lambda *_args, **_kwargs: persisted.append(True),
    )

    with pytest.raises(HTTPException) as rejected:
        await browser.radar_watch(
            browser.RadarWatchRequest(url="http://169.254.169.254/latest/meta-data"),
            object(),
        )
    assert rejected.value.status_code == 400
    assert persisted == []


@pytest.mark.asyncio
async def test_browser_radar_rejects_sensitive_query_before_persisting_watch(monkeypatch):
    async def allow_destination(*_args, **_kwargs):
        return SimpleNamespace(original_url="https://watch.example/change")

    persisted = []
    monkeypatch.setattr(browser, "assert_action_authorized", lambda _value: None)
    monkeypatch.setattr(browser, "_validate_browser_destination", allow_destination)
    monkeypatch.setattr(
        browser,
        "_write_json",
        lambda *_args, **_kwargs: persisted.append(True),
    )

    with pytest.raises(HTTPException) as rejected:
        await browser.radar_watch(
            browser.RadarWatchRequest(
                url="https://watch.example/change?token=must-not-persist"
            ),
            object(),
        )
    assert rejected.value.status_code == 400
    assert persisted == []


@pytest.mark.asyncio
async def test_browser_radar_watch_replaces_opaque_topic_with_fingerprint(monkeypatch):
    opaque_topic = "opaque-radar-topic-secret-1234567890"
    persisted = []

    async def allow_destination(*_args, **_kwargs):
        return SimpleNamespace(original_url="https://watch.example/change")

    monkeypatch.setattr(browser, "assert_action_authorized", lambda _value: None)
    monkeypatch.setattr(browser, "_validate_browser_destination", allow_destination)
    monkeypatch.setattr(browser, "_read_json", lambda *_args, **_kwargs: {"items": []})
    monkeypatch.setattr(
        browser,
        "_write_json",
        lambda _path, payload: persisted.append(payload),
    )

    result = await browser.radar_watch(
        browser.RadarWatchRequest(
            url="https://watch.example/change",
            topic=opaque_topic,
        ),
        object(),
    )

    retained = json.dumps(persisted)
    assert opaque_topic not in retained
    item = persisted[0]["items"][0]
    assert item["topic"] == "[REDACTED]"
    assert len(item["topic_hash"]) == 64
    assert result["item"]["topic"] == "[REDACTED]"


@pytest.mark.asyncio
async def test_temporal_twin_retains_and_returns_only_evidence_fingerprints(monkeypatch):
    opaque_topic = "opaque-twin-topic-secret-1234567890"
    opaque_claim = (
        "Opaque external medical claim with enough characters to be extracted "
        "and never retained verbatim."
    )
    opaque_excerpt = opaque_claim + " opaque-external-excerpt-1234567890"
    persisted = []

    async def fetched(*_args, **_kwargs):
        return {"text": opaque_excerpt, "cached": False}

    monkeypatch.setattr(browser, "_fetch_page_text", fetched)
    monkeypatch.setattr(browser, "assert_action_authorized", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        browser,
        "_append_jsonl",
        lambda _path, row: persisted.append(dict(row)),
    )

    result = await browser.temporal_twin_ingest(
        browser.TemporalTwinIngestRequest(
            url="https://evidence.example/page?opaque=secret-query-value",
            topic=opaque_topic,
        ),
        object(),
    )

    rendered = json.dumps({"persisted": persisted, "result": result})
    for opaque in (opaque_topic, opaque_claim, opaque_excerpt, "secret-query-value"):
        assert opaque not in rendered
    row = persisted[0]
    assert row["topic"] == "[REDACTED]"
    assert len(row["topic_hash"]) == 64
    assert row["claims"] == ["[REDACTED]"]
    assert len(row["claim_hashes"][0]) == 64
    assert row["excerpt"] == "[REDACTED]"
    assert len(row["excerpt_hash"]) == 64

    # A legacy row is reduced before it can be returned or diffed.
    monkeypatch.setattr(
        browser,
        "_read_jsonl",
        lambda *_args, **_kwargs: [
            {
                "ts": "2026-01-01T00:00:00Z",
                "url": "https://evidence.example/page?opaque=legacy-secret",
                "topic": opaque_topic,
                "claims": [opaque_claim],
                "excerpt": opaque_excerpt,
                "content_hash": "a" * 64,
            }
        ],
    )
    queried = await browser.temporal_twin_query(
        browser.TemporalTwinQueryRequest(topic=opaque_topic)
    )
    legacy_rendered = json.dumps(queried)
    for opaque in (opaque_topic, opaque_claim, opaque_excerpt, "legacy-secret"):
        assert opaque not in legacy_rendered
    assert queried["items"][0]["claims"] == ["[REDACTED]"]


@pytest.mark.asyncio
async def test_browser_radar_persists_only_fingerprints_for_topic_excerpt_and_errors(
    monkeypatch,
):
    opaque_topic = "opaque-radar-topic-secret-1234567890"
    opaque_old_excerpt = "opaque-old-external-record-1234567890"
    opaque_new_excerpt = "opaque-new-external-record-1234567890"
    opaque_error = "opaque-upstream-error-1234567890"
    persisted = []

    monkeypatch.setattr(browser, "assert_action_authorized", lambda _value: None)
    monkeypatch.setattr(
        browser,
        "_read_json",
        lambda *_args, **_kwargs: {
            "items": [
                {
                    "url": "https://watch.example/change",
                    "topic": opaque_topic,
                    "last_excerpt": opaque_old_excerpt,
                    "last_hash": "",
                    "error": opaque_error,
                }
            ]
        },
    )

    async def fetched(*_args, **_kwargs):
        return {"text": opaque_new_excerpt, "cached": False}

    monkeypatch.setattr(browser, "_fetch_page_text", fetched)
    monkeypatch.setattr(
        browser,
        "_write_json",
        lambda _path, payload: persisted.append(payload),
    )

    result = await browser.radar_check(browser.RadarCheckRequest(), object())

    retained = json.dumps(persisted)
    for raw_value in (opaque_topic, opaque_old_excerpt, opaque_new_excerpt, opaque_error):
        assert raw_value not in retained
    item = persisted[0]["items"][0]
    assert item["topic"] == "[REDACTED]"
    assert item["last_excerpt"] == "[REDACTED]"
    assert len(item["topic_hash"]) == 64
    assert len(item["last_excerpt_hash"]) == 64
    assert len(item["last_hash"]) == 64
    assert result["checked"] == 1


@pytest.mark.asyncio
async def test_browser_notary_redacts_url_and_external_evidence_before_signing_and_retention(
    monkeypatch,
):
    key = b"dedicated-notary-secret-0000000000000001"
    bearer = "opaque-notary-bearer-1234567890"
    patient_email = "patient@example.test"
    opaque_claim = "opaque-unlabelled-claim-record-1234567890"
    opaque_excerpt = "opaque-unlabelled-external-record-1234567890"
    opaque_path = "opaque-url-record-1234567890"
    retained = []

    async def fetched(*_args, **_kwargs):
        return {
            "text": (
                f"{opaque_excerpt}; diagnostic Bearer {bearer}; "
                f"patient_email={patient_email}"
            ),
            "cached": False,
        }

    monkeypatch.setattr(browser, "_fetch_page_text", fetched)
    monkeypatch.setattr(browser, "assert_action_authorized", lambda _value: None)
    monkeypatch.setattr(browser, "_append_jsonl", lambda _path, row: retained.append(dict(row)))
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(browser_notary_secret=key))
    )

    result = await browser.notary_create(
        browser.NotaryRequest(
            url=(
                f"https://evidence.example/{opaque_path}"
                "?unknown=target-query-secret"
            ),
            claim=f"{opaque_claim}; contact {patient_email}",
        ),
        request,
        object(),
    )

    packet = result["packet"]
    rendered = json.dumps({"returned": packet, "retained": retained})
    for secret in (
        bearer,
        patient_email,
        "target-query-secret",
        opaque_claim,
        opaque_excerpt,
        opaque_path,
    ):
        assert secret not in rendered
    assert packet["url"] == "[REDACTED]"
    assert packet["claim"] == "[REDACTED]"
    assert packet["excerpt"] == "[REDACTED]"
    assert len(packet["url_hash"]) == 64
    assert len(packet["claim_hash"]) == 64
    assert len(packet["excerpt_hash"]) == 64
    assert packet["signature"] == browser._notary_signature(packet, key)
    assert retained == [packet]


@pytest.mark.asyncio
async def test_diplomat_delivery_fails_closed_before_outbound_broker(monkeypatch):
    monkeypatch.setenv(
        "CORTEX_DIPLOMAT_EGRESS_ALLOWED_HOSTS",
        "hooks.example",
    )
    captured = {}

    async def fake_outbound(method, url, **kwargs):
        captured.update(method=method, url=url, **kwargs)
        return EgressResponse(
            status_code=202,
            body=json.dumps({"accepted": True}).encode(),
            headers={"content-type": "application/json"},
            final_url=url,
        )

    monkeypatch.setattr(diplomat, "outbound_request", fake_outbound)
    monkeypatch.setattr(diplomat, "assert_action_authorized", lambda _value: None)
    with pytest.raises(HTTPException) as disabled:
        await diplomat._deliver(
            "https://hooks.example/inbox",
            "hello",
            "POST",
            None,
            5,
            object(),
        )

    assert disabled.value.status_code == 503
    assert captured == {}


@pytest.mark.asyncio
async def test_diplomat_redacts_target_and_upstream_body_before_retention(monkeypatch):
    bearer_secret = "opaque-bearer-credential-1234567890"
    api_secret = "upstream-api-secret-1234567890"
    patient_email = "patient@example.test"

    async def fake_outbound(_method, url, **_kwargs):
        return EgressResponse(
            status_code=200,
            body=json.dumps(
                {
                    "access_token": api_secret,
                    "diagnostic": f"Bearer {bearer_secret}",
                    "patient_email": patient_email,
                }
            ).encode(),
            headers={"content-type": "application/json"},
            final_url=url,
        )

    diplomat._message_log.clear()
    monkeypatch.setattr(diplomat, "outbound_request", fake_outbound)
    monkeypatch.setattr(diplomat, "assert_action_authorized", lambda _value: None)
    with pytest.raises(HTTPException) as disabled:
        await diplomat._deliver(
            "https://hooks.example/inbox?token=target-query-secret",
            "hello",
            "POST",
            None,
            5,
            object(),
        )

    retained = json.dumps(
        {"detail": disabled.value.detail, "log": list(diplomat._message_log)}
    )
    for secret in (
        bearer_secret,
        api_secret,
        patient_email,
        "target-query-secret",
    ):
        assert secret not in retained
    assert disabled.value.status_code == 503
    assert not diplomat._message_log


def test_redactor_removes_unlabelled_bearer_and_basic_credentials():
    bearer_secret = "opaque-bearer-credential-1234567890"
    basic_secret = "Og=="
    redacted = redact_sensitive_data(
        {
            "stdout": f"upstream said Bearer {bearer_secret}",
            "stderr": f"token: Basic {basic_secret}",
        }
    )
    rendered = json.dumps(redacted)
    assert bearer_secret not in rendered
    assert basic_secret not in rendered
    assert rendered.count("[REDACTED]") == 2


def test_redactor_default_drops_opaque_high_risk_content_fields():
    opaque = "opaque-content-secret-1234567890"
    redacted = redact_sensitive_data(
        {
            "stdout": opaque,
            "stderr": opaque,
            "body": {"unlabelled": opaque},
            "upstream_response": opaque,
            "query": opaque,
            "thought": opaque,
            "result": {"value": opaque},
            "chunk": opaque,
            "excerpt": opaque,
            "error": opaque,
            "content_hash": "a" * 64,
            "status_code": 200,
        }
    )

    rendered = json.dumps(redacted)
    assert opaque not in rendered
    for field in (
        "stdout",
        "stderr",
        "body",
        "upstream_response",
        "query",
        "thought",
        "result",
        "chunk",
        "excerpt",
        "error",
    ):
        assert redacted[field] == "[REDACTED]"
    assert redacted["content_hash"] == "a" * 64
    assert redacted["status_code"] == 200


def test_redactor_default_is_recursive_allowlist_for_unknown_fields_and_headers():
    opaque = "OPAQUE_VALUE_WITHOUT_SECRET_LABEL_123456789"
    redacted = redact_sensitive_data(
        {
            "private_context": opaque,
            "nested": {"another_private_field": opaque},
            "content_hash": "b" * 64,
        }
    )
    headers = redact_headers(
        {
            "x-private-context": opaque,
            "x-cortex-read-authorization-mode": "signed_principal_or_admin",
        }
    )

    assert opaque not in json.dumps({"body": redacted, "headers": headers})
    assert redacted["private_context"] == "[REDACTED]"
    assert redacted["nested"] == "[REDACTED]"
    assert redacted["content_hash"] == "b" * 64
    assert headers["x-private-context"] == "[REDACTED]"
    assert headers["x-cortex-read-authorization-mode"] == "signed_principal_or_admin"


def test_http_error_detail_redacts_unlabelled_credentials_and_phi():
    bearer_secret = "opaque-bearer-credential-1234567890"
    patient_email = "patient@example.test"
    detail = _safe_http_detail(
        {
            "diagnostic": f"Bearer {bearer_secret}",
            "patient_email": patient_email,
        },
        status_code=500,
    )
    assert bearer_secret not in detail
    assert patient_email not in detail
    assert detail == "Service unavailable"


@pytest.mark.asyncio
async def test_sentinel_rejects_private_watch_target_before_persistence(monkeypatch):
    monkeypatch.setenv(
        "CORTEX_SENTINEL_EGRESS_ALLOWED_HOSTS",
        "metadata.example",
    )
    monkeypatch.setattr(
        outbound_egress.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("169.254.169.254", port)],
    )
    persisted = []
    monkeypatch.setattr(sentinel, "_save_watchers", lambda: persisted.append(True))
    monkeypatch.setattr(
        sentinel, "assert_action_authorized", lambda *_args, **_kwargs: None
    )

    with pytest.raises(HTTPException) as rejected:
        await sentinel.add_watcher(
            sentinel.WatchRequest(
                name="metadata",
                watch_type="endpoint",
                target="http://metadata.example/latest",
            ),
            object(),
        )
    assert rejected.value.status_code == 400
    assert persisted == []


@pytest.mark.asyncio
async def test_sentinel_rejects_query_bearing_or_caller_selected_persistent_targets(
    monkeypatch,
):
    monkeypatch.setenv("CORTEX_SENTINEL_EGRESS_ALLOWED_HOSTS", "public.example")
    monkeypatch.setenv(
        "CORTEX_SENTINEL_PERSISTENT_TARGETS",
        "https://public.example/health",
    )
    monkeypatch.setattr(
        outbound_egress.socket,
        "getaddrinfo",
        lambda _hostname, port, *_args: [_dns_answer("8.8.8.8", port)],
    )
    monkeypatch.setattr(
        sentinel, "assert_action_authorized", lambda *_args, **_kwargs: None
    )
    persisted = []
    monkeypatch.setattr(sentinel, "_save_watchers", lambda: persisted.append(True))

    for target, expected_status in (
        ("https://public.example/health?opaque=patient-secret", 400),
        ("https://public.example/caller-selected", 403),
    ):
        with pytest.raises(HTTPException) as rejected:
            await sentinel.add_watcher(
                sentinel.WatchRequest(
                    name="opaque-watcher-name",
                    watch_type="endpoint",
                    target=target,
                ),
                object(),
            )
        assert rejected.value.status_code == expected_status

    assert persisted == []


def test_notary_requires_dedicated_non_default_secret():
    provider_only = {"OPENROUTER_API_KEY": "provider-" + ("p" * 40)}
    assert browser.configured_notary_secret(
        required=False,
        environ=provider_only,
    ) is None
    with pytest.raises(RuntimeError, match="required"):
        browser.configured_notary_secret(required=True, environ=provider_only)
    with pytest.raises(RuntimeError, match="dedicated"):
        browser.configured_notary_secret(
            required=True,
            environ={
                "L2_NOTARY_SECRET": provider_only["OPENROUTER_API_KEY"],
                **provider_only,
            },
        )
    delegated = "deferred-action-secret-0000000000000001"
    with pytest.raises(RuntimeError, match="dedicated"):
        browser.configured_notary_secret(
            required=True,
            environ={
                "L2_NOTARY_SECRET": delegated,
                "CORTEX_ACTION_DELEGATION_SECRET": delegated,
            },
        )
    with pytest.raises(RuntimeError):
        browser.configured_notary_secret(
            required=True,
            environ={"L2_NOTARY_SECRET": "cortex-notary-default"},
        )
    principal_secret = "principal-scope-secret-" + ("s" * 32)
    with pytest.raises(RuntimeError, match="dedicated"):
        browser.configured_notary_secret(
            required=True,
            environ={"L2_NOTARY_SECRET": principal_secret},
            disallowed_candidates=(principal_secret,),
        )


@pytest.mark.asyncio
async def test_notary_verify_is_constant_time_boolean_status_without_signature_oracle():
    key = b"dedicated-notary-secret-0000000000000001"
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(browser_notary_secret=key),
        )
    )
    packet = {
        "packet_id": "packet-1",
        "ts": "2026-08-22T00:00:00Z",
        "url": "https://evidence.example/item",
        "claim": "bounded claim",
        "content_hash": "a" * 64,
        "excerpt": "bounded evidence",
        "source_engine": "ghost_playwright",
    }
    packet["signature"] = browser._notary_signature(packet, key)

    verified = await browser.notary_verify(
        browser.NotaryVerifyRequest(packet=packet),
        request,
    )
    tampered = dict(packet, claim="tampered")
    rejected = await browser.notary_verify(
        browser.NotaryVerifyRequest(packet=tampered),
        request,
    )

    assert verified == {"success": True, "valid": True}
    assert rejected == {"success": True, "valid": False}
    assert "signature" not in verified
    assert "supplied" not in verified
    assert "recomputed" not in verified


@pytest.mark.asyncio
async def test_notary_operation_fails_closed_without_startup_secret():
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    with pytest.raises(HTTPException) as unavailable:
        await browser.notary_verify(
            browser.NotaryVerifyRequest(packet={"signature": "0" * 64}),
            request,
        )
    assert unavailable.value.status_code == 503


def test_production_app_requires_notary_secret_at_startup(monkeypatch):
    from cortex_server import main
    from cortex_server.runtime import production_build_loop

    monkeypatch.setattr(main, "_production_environment", lambda: True)
    monkeypatch.setattr(
        main,
        "_knowledge_volume_identity_check",
        lambda **_kwargs: {"ok": True, "error": None},
    )
    monkeypatch.setattr(
        main,
        "_parse_read_scope_credentials",
        lambda _raw: (
            main.ReadScopeCredential(
                credential_id="reader",
                secret="reader-" + ("r" * 32),
                allowed_scopes=("*",),
            ),
        ),
    )
    monkeypatch.setattr(
        production_build_loop,
        "validate_production_delivery_credentials",
        lambda: None,
    )
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "write-" + ("w" * 32))
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "admin-" + ("a" * 32))
    monkeypatch.setenv("CORTEX_CODEC_ADMIN_TOKEN", "codec-" + ("c" * 32))
    monkeypatch.setenv(
        "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN",
        "artifact-" + ("t" * 32),
    )
    monkeypatch.setenv(
        "CORTEX_ACTION_DELEGATION_SECRET",
        "delegation-" + ("d" * 32),
    )
    monkeypatch.delenv("L2_NOTARY_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="L2_NOTARY_SECRET is required"):
        main.create_app()

    monkeypatch.setenv("L2_NOTARY_SECRET", "reader-" + ("r" * 32))
    with pytest.raises(RuntimeError, match="dedicated"):
        main.create_app()
