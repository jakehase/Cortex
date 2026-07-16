import asyncio
import os
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, Request, WebSocketDisconnect
from starlette.datastructures import Headers

from cortex_server.middleware.request_body_limit import RequestBodyLimitMiddleware
from cortex_server.middleware.write_authorization import WriteAuthorizationMiddleware
from cortex_server.routers import websockets
from cortex_server.tools import docker_wrapper


def websocket_security_from_env():
    """Capture the same immutable, app-scoped policy shape as create_app()."""
    allowed_origins = frozenset(
        origin.strip()
        for origin in os.getenv(
            "CORTEX_ALLOW_ORIGINS", "http://localhost,https://localhost"
        ).split(",")
        if origin.strip()
    )
    return SimpleNamespace(
        write_auth_mode=os.getenv(
            "CORTEX_WRITE_AUTH_MODE", "token_or_loopback"
        ).strip().lower(),
        write_token=os.getenv("CORTEX_WRITE_TOKEN", "").strip(),
        write_token_header=os.getenv(
            "CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token"
        ).strip().lower(),
        admin_token=os.getenv("CORTEX_ADMIN_TOKEN", "").strip(),
        allowed_origins=allowed_origins,
    )


class FakeWebSocket:
    def __init__(
        self,
        *,
        headers=None,
        host="127.0.0.1",
        fail_send=False,
        security=None,
    ):
        self.headers = Headers(headers=headers or {})
        self.client = SimpleNamespace(host=host) if host is not None else None
        self.app = SimpleNamespace(
            state=SimpleNamespace(
                websocket_security=security or websocket_security_from_env()
            )
        )
        self.fail_send = fail_send
        self.accepted = False
        self.closed = []
        self.text = []
        self.json = []

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000, reason=None):
        self.closed.append((code, reason))

    async def send_text(self, value):
        if self.fail_send:
            raise WebSocketDisconnect()
        self.text.append(value)

    async def send_json(self, value):
        self.json.append(value)


class FakeLogs:
    def __init__(self, lines=()):
        self.lines = iter(lines)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.lines)
        except StopIteration:
            raise StopAsyncIteration

    async def aclose(self):
        self.closed = True


class DockerFactory:
    def __init__(self, streams=()):
        self.streams = list(streams)
        self.constructed = 0
        self.calls = []

    def __call__(self):
        self.constructed += 1
        factory = self

        class Containers:
            def logs(self, container_id, **kwargs):
                factory.calls.append((container_id, kwargs))
                return factory.streams.pop(0)

        return SimpleNamespace(containers=Containers())


def configure_token(monkeypatch, mode="token_required"):
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", mode)
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "correct-secret")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN_HEADER", "x-test-token")
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "admin-secret")


@pytest.mark.asyncio
@pytest.mark.parametrize("supplied", [None, "wrong-secret"])
async def test_missing_or_wrong_token_is_rejected_before_docker(monkeypatch, supplied):
    configure_token(monkeypatch)
    factory = DockerFactory()
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    headers = {} if supplied is None else {"x-test-token": supplied}
    socket = FakeWebSocket(headers=headers, host="203.0.113.9")

    await websockets.ws_logs(socket, "safe-container")

    assert socket.accepted is False
    assert socket.closed == [(1008, "connection rejected")]
    assert factory.constructed == 0


@pytest.mark.asyncio
async def test_token_comparison_path_uses_constant_time_helper(monkeypatch):
    configure_token(monkeypatch)
    calls = []

    def compare(supplied, configured):
        calls.append((supplied, configured))
        return False

    monkeypatch.setattr(websockets, "token_matches", compare)
    socket = FakeWebSocket(headers={"x-cortex-admin-token": "candidate"}, host="203.0.113.9")
    await websockets.ws_logs(socket, "container")
    assert calls == [("candidate", "admin-secret")]
    assert socket.closed[0][0] == 1008


@pytest.mark.asyncio
async def test_websocket_policy_is_immutable_after_socket_app_capture(monkeypatch):
    configure_token(monkeypatch)
    factory = DockerFactory()
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    socket = FakeWebSocket(host="203.0.113.9")

    # A process-environment mutation after app/socket construction must not
    # weaken the policy captured for that application instance.
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "disabled")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "")
    await websockets.ws_logs(socket, "container")

    assert socket.accepted is False
    assert socket.closed == [(1008, "connection rejected")]
    assert factory.constructed == 0


@pytest.mark.asyncio
async def test_correct_token_accepts_and_bounds_docker_log_request(monkeypatch):
    configure_token(monkeypatch)
    logs = FakeLogs(["one", "two"])
    factory = DockerFactory([logs])
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    socket = FakeWebSocket(headers={"x-cortex-admin-token": "admin-secret"}, host="203.0.113.9")

    await websockets.ws_logs(socket, "api_1.prod")

    assert socket.accepted is True
    assert socket.text == ["one", "two"]
    assert factory.calls == [("api_1.prod", {"follow": True, "tail": 100})]
    assert logs.closed is True


@pytest.mark.asyncio
async def test_loopback_and_forwarding_do_not_replace_administrator_authorization(monkeypatch):
    configure_token(monkeypatch, "token_or_loopback")
    direct_logs = FakeLogs()
    forwarded_logs = FakeLogs()
    factory = DockerFactory([direct_logs, forwarded_logs])
    monkeypatch.setattr(docker_wrapper, "Docker", factory)

    direct = FakeWebSocket(host="::1")
    await websockets.ws_logs(direct, "container")
    forwarded = FakeWebSocket(headers={"x-forwarded-for": "127.0.0.1"})
    await websockets.ws_logs(forwarded, "container")
    authorized_forwarded = FakeWebSocket(
        headers={"forwarded": "for=127.0.0.1", "x-cortex-admin-token": "admin-secret"}
    )
    await websockets.ws_logs(authorized_forwarded, "container")

    assert direct.accepted is False
    assert forwarded.accepted is False
    assert forwarded.closed == [(1008, "connection rejected")]
    assert authorized_forwarded.accepted is True
    assert factory.constructed == 1


@pytest.mark.asyncio
async def test_disabled_mode_still_protects_remote_log_streams(monkeypatch):
    configure_token(monkeypatch, "disabled")
    factory = DockerFactory()
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    sockets = [
        FakeWebSocket(host="203.0.113.9"),
        FakeWebSocket(headers={"x-test-token": "wrong-secret"}, host="203.0.113.10"),
        FakeWebSocket(headers={"x-forwarded-for": "127.0.0.1"}),
    ]

    await asyncio.gather(*(websockets.ws_logs(socket, "container") for socket in sockets))

    assert all(socket.accepted is False for socket in sockets)
    assert all(socket.closed == [(1008, "connection rejected")] for socket in sockets)
    assert factory.constructed == 0


@pytest.mark.asyncio
async def test_disabled_write_mode_still_requires_log_administrator(monkeypatch):
    configure_token(monkeypatch, "disabled")
    factory = DockerFactory([FakeLogs()])
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    direct = FakeWebSocket(host="::1")
    remote = FakeWebSocket(
        headers={"x-test-token": "correct-secret"}, host="203.0.113.9"
    )
    admin = FakeWebSocket(
        headers={"x-cortex-admin-token": "admin-secret"}, host="203.0.113.9"
    )

    await websockets.ws_logs(direct, "local-container")
    await websockets.ws_logs(remote, "remote-container")
    await websockets.ws_logs(admin, "admin-container")

    assert direct.accepted is False
    assert remote.accepted is False
    assert admin.accepted is True
    assert factory.constructed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "container_id,headers",
    [
        ("../docker.sock", {}),
        ("name/other", {}),
        ("x" * 129, {}),
        ("valid", {"origin": "https://evil.example"}),
        ("valid", {"origin": "http://localhost.evil.example"}),
    ],
)
async def test_hostile_identifier_or_origin_fails_closed_before_docker(
    monkeypatch, container_id, headers
):
    configure_token(monkeypatch, "token_or_loopback")
    factory = DockerFactory()
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    socket = FakeWebSocket(headers=headers)
    await websockets.ws_logs(socket, container_id)
    assert socket.closed == [(1008, "connection rejected")]
    assert socket.accepted is False
    assert factory.constructed == 0


@pytest.mark.asyncio
async def test_configured_origin_and_missing_browser_origin_are_compatible(monkeypatch):
    configure_token(monkeypatch, "token_or_loopback")
    monkeypatch.setenv("CORTEX_ALLOW_ORIGINS", "https://console.example")
    factory = DockerFactory([FakeLogs(), FakeLogs()])
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    for headers in ({"origin": "https://console.example", "x-cortex-admin-token": "admin-secret"}, {"x-cortex-admin-token": "admin-secret"}):
        socket = FakeWebSocket(headers=headers)
        await websockets.ws_logs(socket, "container")
        assert socket.accepted is True


@pytest.mark.asyncio
async def test_disconnect_and_concurrent_streams_close_each_resource(monkeypatch):
    configure_token(monkeypatch, "token_or_loopback")
    first, second = FakeLogs(["a"]), FakeLogs(["b"])
    factory = DockerFactory([first, second])
    monkeypatch.setattr(docker_wrapper, "Docker", factory)
    disconnected = FakeWebSocket(headers={"x-cortex-admin-token": "admin-secret"}, fail_send=True)
    healthy = FakeWebSocket(headers={"x-cortex-admin-token": "admin-secret"})

    await asyncio.gather(
        websockets.ws_logs(disconnected, "first"),
        websockets.ws_logs(healthy, "second"),
    )

    assert first.closed and second.closed
    assert healthy.text == ["b"]
    assert factory.constructed == 2


@pytest.mark.asyncio
async def test_docker_failure_returns_only_sanitized_error_and_recovers(monkeypatch):
    configure_token(monkeypatch, "token_or_loopback")
    secret = "daemon at /run/secret.sock refused super-secret credential"

    class BrokenThenHealthy:
        calls = 0

        def __init__(self):
            self.containers = self

        def logs(self, *_args, **_kwargs):
            type(self).calls += 1
            if type(self).calls == 1:
                raise RuntimeError(secret)
            return FakeLogs(["recovered"])

    monkeypatch.setattr(docker_wrapper, "Docker", BrokenThenHealthy)
    failed = FakeWebSocket(headers={"x-cortex-admin-token": "admin-secret"})
    recovered = FakeWebSocket(headers={"x-cortex-admin-token": "admin-secret"})
    await websockets.ws_logs(failed, "container")
    await websockets.ws_logs(recovered, "container")

    assert failed.json == [{"type": "error", "message": "log stream unavailable"}]
    assert failed.closed == [(1011, "log stream unavailable")]
    assert secret not in repr((failed.json, failed.closed))
    assert recovered.text == ["recovered"]


@pytest.mark.asyncio
async def test_http_direct_loopback_compatibility_and_forwarded_fail_closed():
    app = FastAPI()
    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode="token_or_loopback",
        token="http-secret",
        header_name="x-http-token",
    )

    @app.post("/write")
    async def write():
        return {"ok": True}

    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 1234))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.post("/write")).status_code == 200
        denied = await client.post("/write", headers={"x-forwarded-for": "127.0.0.1"})
        allowed = await client.post(
            "/write",
            headers={"x-forwarded-for": "127.0.0.1", "x-http-token": "http-secret"},
        )
    assert denied.status_code == 403
    assert denied.json()["error"] == "write authorization required"
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_log_websocket_sanitizes_docker_constructor_failure(monkeypatch):
    from cortex_server.routers import websockets as ws_router
    from cortex_server.tools import docker_wrapper

    class BrokenDocker:
        def __init__(self):
            raise RuntimeError("private docker detail")

    class FakeSocket:
        headers = {"origin": "http://localhost", "authorization": "Bearer secret"}
        query_params = {}
        accepted = False
        sent = []
        closed = []

        async def accept(self):
            self.accepted = True

        async def send_json(self, value):
            self.sent.append(value)

        async def close(self, **value):
            self.closed.append(value)

    socket = FakeSocket()
    monkeypatch.setattr(ws_router, "_allowed_websocket_origin", lambda _ws: True)
    monkeypatch.setattr(ws_router, "_log_websocket_authorized", lambda _ws: True)
    monkeypatch.setattr(docker_wrapper, "Docker", BrokenDocker)

    await ws_router.ws_logs(socket, "container-1")

    assert socket.accepted is True
    assert socket.sent == [{"type": "error", "message": "log stream unavailable"}]
    assert socket.closed == [{"code": 1011, "reason": "log stream unavailable"}]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    (
        "/orchestrator/runtime/delivery/artifacts/proc_body_limit",
        "/conductor/runtime/delivery/artifacts/proc_body_limit",
    ),
)
async def test_chunked_oversized_invalid_hmac_is_rejected_before_json_dispatch(path):
    dispatched = []
    app = FastAPI()

    @app.post(path)
    async def artifact_ingest(request: Request):
        dispatched.append(await request.json())
        return {"success": True}

    app.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=96)

    async def invalid_hmac_chunks():
        yield b'{"attestation_signature":"' + (b"0" * 64) + b'","payload":"'
        yield b"x" * 64
        yield b'"}'

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            path,
            content=invalid_hmac_chunks(),
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 413
    assert response.json()["error"] == "request body exceeds configured limit"
    assert dispatched == []


@pytest.mark.asyncio
async def test_oversized_content_length_is_rejected_without_reading_or_dispatching():
    receive_calls = []
    downstream_calls = []
    sent = []

    async def downstream(_scope, _receive, _send):
        downstream_calls.append(True)

    async def receive():
        receive_calls.append(True)
        raise AssertionError("declared oversized bodies must be rejected before receive")

    async def send(message):
        sent.append(message)

    limiter = RequestBodyLimitMiddleware(downstream, max_body_bytes=32)
    await limiter(
        {
            "type": "http",
            "method": "POST",
            "path": "/orchestrator/runtime/delivery/artifacts/proc_declared",
            "headers": [(b"content-length", b"33")],
        },
        receive,
        send,
    )

    assert sent[0]["status"] == 413
    assert receive_calls == []
    assert downstream_calls == []


def test_global_request_body_limiter_is_outermost_and_configured(monkeypatch):
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    monkeypatch.setenv("CORTEX_MAX_REQUEST_BODY_BYTES", "12345")
    from cortex_server import main

    app = main.create_app()

    assert app.state.max_request_body_bytes == 12345
    assert app.user_middleware[0].cls is RequestBodyLimitMiddleware
    assert app.user_middleware[0].kwargs["max_body_bytes"] == 12345


@pytest.mark.asyncio
async def test_outer_body_limiter_times_out_stalled_chunk_before_dispatch():
    downstream_calls = []
    sent = []
    receive_calls = 0

    async def downstream(_scope, _receive, _send):
        downstream_calls.append(True)

    async def receive():
        nonlocal receive_calls
        receive_calls += 1
        if receive_calls == 1:
            return {"type": "http.request", "body": b"partial", "more_body": True}
        await asyncio.Event().wait()

    async def send(message):
        sent.append(message)

    limiter = RequestBodyLimitMiddleware(
        downstream,
        max_body_bytes=32,
        idle_timeout_seconds=0.02,
        total_timeout_seconds=0.05,
        max_concurrent_body_reads=2,
        max_buffered_body_bytes=32,
    )
    await asyncio.wait_for(
        limiter(
            {"type": "http", "method": "POST", "path": "/write", "headers": []},
            receive,
            send,
        ),
        timeout=0.2,
    )

    assert sent[0]["status"] == 408
    assert (b"connection", b"close") in sent[0]["headers"]
    assert downstream_calls == []
    assert limiter._active_body_reads == 0
    assert limiter._buffered_body_bytes == 0


@pytest.mark.asyncio
async def test_outer_body_limiter_bounds_concurrent_unauthenticated_partial_bodies():
    entered = asyncio.Event()
    sent = [[], [], []]

    async def downstream(_scope, _receive, _send):
        raise AssertionError("partial bodies must never dispatch")

    def receiver():
        calls = 0

        async def receive():
            nonlocal calls
            calls += 1
            if calls == 1:
                entered.set()
                return {"type": "http.request", "body": b"12345678", "more_body": True}
            await asyncio.Event().wait()

        return receive

    limiter = RequestBodyLimitMiddleware(
        downstream,
        max_body_bytes=32,
        idle_timeout_seconds=0.08,
        total_timeout_seconds=0.04,
        max_concurrent_body_reads=2,
        max_buffered_body_bytes=32,
    )

    async def run(index):
        async def send(message):
            sent[index].append(message)
        await limiter(
            {"type": "http", "method": "POST", "path": "/write", "headers": []},
            receiver(),
            send,
        )

    first = asyncio.create_task(run(0))
    second = asyncio.create_task(run(1))
    await entered.wait()
    third = asyncio.create_task(run(2))
    await asyncio.gather(first, second, third)

    statuses = sorted(messages[0]["status"] for messages in sent)
    assert statuses == [408, 408, 503]
    assert limiter._active_body_reads == 0
    assert limiter._buffered_body_bytes == 0


@pytest.mark.asyncio
async def test_outer_body_limiter_rejects_missing_write_token_without_receiving_body():
    receive_calls = []
    sent = []

    async def receive():
        receive_calls.append(True)
        raise AssertionError("authorization rejection must precede body acquisition")

    async def send(message):
        sent.append(message)

    limiter = RequestBodyLimitMiddleware(
        lambda *_args: None,
        max_body_bytes=32,
        write_auth_mode="token_required",
        write_token="expected-token",
    )
    await limiter(
        {"type": "http", "method": "POST", "path": "/write", "headers": []},
        receive,
        send,
    )

    assert sent[0]["status"] == 403
    assert receive_calls == []


@pytest.mark.asyncio
async def test_bodyless_reads_and_ready_bypass_saturated_body_reader_pool():
    entered = asyncio.Event()
    release = asyncio.Event()
    dispatched = []

    async def downstream(scope, _receive, send):
        dispatched.append(scope["path"])
        if scope["path"].startswith("/slow"):
            entered.set()
            await release.wait()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    limiter = RequestBodyLimitMiddleware(
        downstream,
        max_body_bytes=32,
        max_concurrent_body_reads=2,
        max_buffered_body_bytes=64,
    )

    async def bodyless(path):
        sent = []

        async def receive():
            raise AssertionError("bodyless GET must not consume receive")

        async def send(message):
            sent.append(message)

        await limiter(
            {"type": "http", "method": "GET", "path": path, "headers": []},
            receive,
            send,
        )
        return sent

    first = asyncio.create_task(bodyless("/slow/one"))
    second = asyncio.create_task(bodyless("/slow/two"))
    await entered.wait()
    ready = await asyncio.wait_for(bodyless("/ready"), timeout=0.2)
    assert ready[0]["status"] == 200
    assert limiter._active_body_reads == 0
    release.set()
    await asyncio.gather(first, second)
    assert "/ready" in dispatched


@pytest.mark.asyncio
async def test_reader_slot_is_released_after_acquisition_while_buffer_remains_accounted():
    first_dispatched = asyncio.Event()
    release = asyncio.Event()

    async def downstream(scope, _receive, send):
        if scope["path"] == "/first":
            first_dispatched.set()
            await release.wait()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    limiter = RequestBodyLimitMiddleware(
        downstream,
        max_body_bytes=32,
        max_concurrent_body_reads=1,
        max_buffered_body_bytes=64,
    )

    async def post(path, body):
        messages = iter([{"type": "http.request", "body": body, "more_body": False}])

        async def receive():
            return next(messages)

        sent = []
        async def send(message):
            sent.append(message)
        await limiter(
            {
                "type": "http",
                "method": "POST",
                "path": path,
                "headers": [(b"content-length", str(len(body)).encode("ascii"))],
            },
            receive,
            send,
        )
        return sent

    first = asyncio.create_task(post("/first", b"12345678"))
    await first_dispatched.wait()
    assert limiter._active_body_reads == 0
    assert limiter._buffered_body_bytes == 8
    second = await asyncio.wait_for(post("/second", b"abcdefgh"), timeout=0.2)
    assert second[0]["status"] == 200
    assert limiter._buffered_body_bytes == 8
    release.set()
    await first
    assert limiter._buffered_body_bytes == 0


@pytest.mark.asyncio
async def test_get_with_declared_body_is_rejected_without_reader_admission():
    sent = []
    receive_calls = []
    limiter = RequestBodyLimitMiddleware(
        lambda *_args: (_ for _ in ()).throw(AssertionError("must not dispatch")),
        max_body_bytes=32,
    )

    async def receive():
        receive_calls.append(True)
        return {"type": "http.request", "body": b"x", "more_body": False}

    async def send(message):
        sent.append(message)

    await limiter(
        {"type": "http", "method": "GET", "path": "/read", "headers": [(b"content-length", b"1")]},
        receive,
        send,
    )
    assert sent[0]["status"] == 400
    assert receive_calls == []
    assert limiter._active_body_reads == 0
