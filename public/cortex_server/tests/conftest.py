from __future__ import annotations

import asyncio
import contextvars
import functools
import sys
import threading
from pathlib import Path

import fastapi.testclient
import httpx
import pytest
import starlette.testclient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class _ASGICompatTestClient:
    """Compatibility client for the installed HTTPX/Starlette transition."""

    def __init__(
        self,
        app,
        *,
        base_url="http://testserver",
        raise_server_exceptions=True,
        headers=None,
        cookies=None,
        follow_redirects=True,
        **_kwargs,
    ):
        self.app = app
        self.base_url = base_url
        self.raise_server_exceptions = raise_server_exceptions
        self.follow_redirects = follow_redirects
        self.headers = httpx.Headers(headers or {})
        self.cookies = httpx.Cookies(cookies)

    def request(self, method, path, **kwargs):
        request_headers = httpx.Headers(self.headers)
        request_headers.update(kwargs.pop("headers", {}) or {})

        async def send():
            transport = httpx.ASGITransport(
                app=self.app,
                raise_app_exceptions=self.raise_server_exceptions,
            )
            async with httpx.AsyncClient(
                transport=transport,
                base_url=self.base_url,
                headers=request_headers,
                cookies=self.cookies,
                follow_redirects=self.follow_redirects,
            ) as client:
                response = await client.request(method, path, **kwargs)
                self.cookies.update(response.cookies)
                return response

        return asyncio.run(send())

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def put(self, path, **kwargs):
        return self.request("PUT", path, **kwargs)

    def patch(self, path, **kwargs):
        return self.request("PATCH", path, **kwargs)

    def delete(self, path, **kwargs):
        return self.request("DELETE", path, **kwargs)

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


# The environment ships the HTTPX transition release for which Starlette's
# legacy blocking portal can wait indefinitely.  Preserve the same ASGI
# request contract for all route tests through HTTPX's supported transport.
def _asgi_test_client(*args, **kwargs):
    return _ASGICompatTestClient(*args, **kwargs)


fastapi.testclient.TestClient = _asgi_test_client
starlette.testclient.TestClient = _asgi_test_client


async def _shutdown_default_executor_synchronously(loop, _timeout=None):
    """Avoid the Python 3.12 helper-thread shutdown deadlock in this runner."""
    loop._executor_shutdown_called = True
    executor = loop._default_executor
    if executor is not None:
        executor.shutdown(wait=True)


asyncio.base_events.BaseEventLoop.shutdown_default_executor = _shutdown_default_executor_synchronously


async def _fresh_thread(function, /, *args, **kwargs):
    """Run every test offload on a fresh worker in this constrained runner."""
    context = contextvars.copy_context()
    call = functools.partial(context.run, function, *args, **kwargs)
    completed = threading.Event()
    outcome = {}

    def invoke():
        try:
            outcome["result"] = call()
        except BaseException as exc:
            outcome["error"] = exc
        finally:
            completed.set()

    threading.Thread(target=invoke, daemon=True).start()
    while not completed.is_set():
        await asyncio.sleep(0.001)
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("result")


asyncio.to_thread = _fresh_thread


@pytest.fixture(autouse=True)
def isolate_generated_homeostasis_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("CORTEX_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    monkeypatch.setenv("CORTEX_DB_PATH", str(tmp_path / "cortex-graph.db"))
    monkeypatch.setenv(
        "CORTEX_L22_STRUCTURED_DB",
        str(tmp_path / "l22-structured.sqlite3"),
    )
    try:
        import cortex_server.routers.nexus as nexus
        import cortex_server.routers.oracle as oracle
        import cortex_server.routers.orchestrator as orchestrator
        import cortex_server.modules.reasoning_approvals as reasoning_approvals
        import cortex_server.modules.reasoning_beliefs as reasoning_beliefs
        import cortex_server.modules.reasoning_scheduler as reasoning_scheduler
        import cortex_server.modules.reasoning_store as reasoning_store

        async def run_inline(function, *args, **kwargs):
            return function(*args, **kwargs)

        monkeypatch.setattr(nexus, "run_in_threadpool", run_inline)
        monkeypatch.setattr(oracle, "run_in_threadpool", run_inline)

        original_transaction = nexus.ExecutionTransaction
        def isolated_transaction(**kwargs):
            kwargs.setdefault("journal_dir", tmp_path / "nexus-transactions")
            return original_transaction(**kwargs)

        monkeypatch.setattr(
            nexus,
            "ExecutionTransaction",
            isolated_transaction,
        )
        monkeypatch.setattr(nexus, "_ADAPTIVE_STATE_ROOT", tmp_path / "nexus-adaptive")
        nexus._ADAPTIVE_POLICY_STATES.clear()
        monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime-delivery")
        reasoning_db = tmp_path / "reasoning-runtime.db"
        monkeypatch.setattr(reasoning_scheduler, "DEFAULT_DB_PATH", reasoning_db)
        monkeypatch.setattr(reasoning_scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning-scheduler.json")
        monkeypatch.setattr(reasoning_store, "DEFAULT_DB_PATH", reasoning_db)
        monkeypatch.setattr(reasoning_approvals, "DEFAULT_DB_PATH", reasoning_db)
        monkeypatch.setattr(reasoning_beliefs, "DEFAULT_DB_PATH", reasoning_db)
        monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", reasoning_db)
    except ImportError:
        pass
