import asyncio
import os
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, WebSocketDisconnect
from starlette.datastructures import Headers

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
