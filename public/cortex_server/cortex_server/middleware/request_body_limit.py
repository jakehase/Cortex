"""Outer ASGI request-body admission control.

The limiter consumes an HTTP request body before dispatching it.  This keeps
chunked requests from reaching parsers or handlers until their complete size
has been proven to be within the configured bound.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Any

from cortex_server.middleware.write_authorization import (
    MUTATING_METHODS,
    is_trusted_browser_context,
    is_trusted_direct_loopback,
    token_matches,
)


DEFAULT_MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024
DEFAULT_BODY_IDLE_TIMEOUT_SECONDS = 2.0
DEFAULT_BODY_TOTAL_TIMEOUT_SECONDS = 10.0
DEFAULT_MAX_CONCURRENT_BODY_READS = 32
DEFAULT_MAX_BUFFERED_BODY_BYTES = 32 * 1024 * 1024


def configured_max_request_body_bytes(raw: str | None) -> int:
    value = str(raw or "").strip()
    if not value:
        return DEFAULT_MAX_REQUEST_BODY_BYTES
    if not value.isdecimal():
        raise RuntimeError("CORTEX_MAX_REQUEST_BODY_BYTES must be a positive integer")
    limit = int(value)
    if limit <= 0:
        raise RuntimeError("CORTEX_MAX_REQUEST_BODY_BYTES must be a positive integer")
    return limit


class RequestBodyLimitMiddleware:
    """Bound body size, acquisition time, concurrency, and retained bytes."""

    def __init__(
        self,
        app: Any,
        *,
        max_body_bytes: int = DEFAULT_MAX_REQUEST_BODY_BYTES,
        idle_timeout_seconds: float = DEFAULT_BODY_IDLE_TIMEOUT_SECONDS,
        total_timeout_seconds: float = DEFAULT_BODY_TOTAL_TIMEOUT_SECONDS,
        max_concurrent_body_reads: int = DEFAULT_MAX_CONCURRENT_BODY_READS,
        max_buffered_body_bytes: int = DEFAULT_MAX_BUFFERED_BODY_BYTES,
        write_auth_mode: str = "disabled",
        write_token: str = "",
        write_token_header: str = "x-cortex-write-token",
        allowed_origins: tuple[str, ...] = (),
        auth_exempt_prefixes: tuple[str, ...] = (),
    ):
        if int(max_body_bytes) <= 0:
            raise ValueError("max_body_bytes must be positive")
        if float(idle_timeout_seconds) <= 0 or float(total_timeout_seconds) <= 0:
            raise ValueError("request body timeouts must be positive")
        if int(max_concurrent_body_reads) <= 0 or int(max_buffered_body_bytes) <= 0:
            raise ValueError("request body admission budgets must be positive")
        if int(max_buffered_body_bytes) < int(max_body_bytes):
            raise ValueError("aggregate request body budget must cover one maximum-sized body")
        self.app = app
        self.max_body_bytes = int(max_body_bytes)
        self.idle_timeout_seconds = float(idle_timeout_seconds)
        self.total_timeout_seconds = float(total_timeout_seconds)
        self.max_concurrent_body_reads = int(max_concurrent_body_reads)
        self.max_buffered_body_bytes = int(max_buffered_body_bytes)
        self.write_auth_mode = str(write_auth_mode or "disabled").strip().lower()
        self.write_token = str(write_token or "").strip()
        self.write_token_header = str(write_token_header or "x-cortex-write-token").strip().lower()
        self.allowed_origins = frozenset(allowed_origins)
        self.auth_exempt_prefixes = tuple(str(value).rstrip("/") for value in auth_exempt_prefixes)
        # A regular threading lock keeps these counters safe when an ASGI app is
        # driven from more than one event loop (tests and multi-threaded hosts).
        self._budget_lock = threading.Lock()
        self._active_body_reads = 0
        self._buffered_body_bytes = 0

    @staticmethod
    def _declared_content_length(scope: dict[str, Any]) -> int | None:
        values: list[str] = []
        for name, value in scope.get("headers") or []:
            if bytes(name).lower() != b"content-length":
                continue
            try:
                decoded = bytes(value).decode("ascii")
            except UnicodeDecodeError as exc:
                raise ValueError("invalid Content-Length header") from exc
            values.extend(part.strip() for part in decoded.split(","))
        if not values:
            return None
        if any(not value or not value.isdecimal() for value in values):
            raise ValueError("invalid Content-Length header")
        lengths = {int(value) for value in values}
        if len(lengths) != 1:
            raise ValueError("conflicting Content-Length headers")
        return lengths.pop()

    @staticmethod
    async def _send_json(send: Any, *, status: int, payload: dict[str, Any], head: bool) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = [
            (b"content-type", b"application/json"),
            (b"content-length", str(0 if head else len(encoded)).encode("ascii")),
            (b"connection", b"close"),
        ]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": b"" if head else encoded})

    @staticmethod
    def _headers(scope: dict[str, Any]) -> dict[str, str]:
        headers: dict[str, str] = {}
        for raw_name, raw_value in scope.get("headers") or []:
            try:
                name = bytes(raw_name).decode("latin-1").lower()
                value = bytes(raw_value).decode("latin-1")
            except (UnicodeDecodeError, ValueError):
                continue
            headers[name] = value
        return headers

    def _prebuffer_authorized(self, scope: dict[str, Any]) -> bool:
        """Perform the transport-token decision before reading a write body."""

        method = str(scope.get("method") or "").upper()
        path = str(scope.get("path") or "")
        if (
            self.write_auth_mode == "disabled"
            or method not in MUTATING_METHODS
            or any(path == prefix or path.startswith(f"{prefix}/") for prefix in self.auth_exempt_prefixes)
        ):
            return True
        headers = self._headers(scope)
        client = scope.get("client") or ("", 0)
        client_host = str(client[0] if isinstance(client, (tuple, list)) and client else "")
        if (
            self.write_auth_mode == "token_or_loopback"
            and is_trusted_direct_loopback(client_host, headers)
            and is_trusted_browser_context(headers, self.allowed_origins)
        ):
            return True
        return token_matches(headers.get(self.write_token_header, ""), self.write_token)

    def _acquire_admission(self) -> bool:
        # Do not queue an unbounded number of request tasks behind this budget.
        # Capacity exhaustion is an immediate, fail-closed rejection.
        with self._budget_lock:
            if self._active_body_reads >= self.max_concurrent_body_reads:
                return False
            self._active_body_reads += 1
            return True

    def _reserve_buffer(self, amount: int) -> bool:
        with self._budget_lock:
            if self._buffered_body_bytes + amount > self.max_buffered_body_bytes:
                return False
            self._buffered_body_bytes += amount
            return True

    def _release_admission(self, retained_bytes: int) -> None:
        with self._budget_lock:
            self._buffered_body_bytes = max(0, self._buffered_body_bytes - retained_bytes)
            self._active_body_reads = max(0, self._active_body_reads - 1)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        head = str(scope.get("method") or "").upper() == "HEAD"
        try:
            declared = self._declared_content_length(scope)
        except ValueError as exc:
            await self._send_json(
                send,
                status=400,
                payload={"success": False, "error": str(exc)},
                head=head,
            )
            return
        if declared is not None and declared > self.max_body_bytes:
            await self._send_json(
                send,
                status=413,
                payload={"success": False, "error": "request body exceeds configured limit"},
                head=head,
            )
            return

        if not self._prebuffer_authorized(scope):
            await self._send_json(
                send,
                status=403,
                payload={
                    "success": False,
                    "error": "write authorization is not configured" if not self.write_token else "write authorization required",
                    "authorizationMode": self.write_auth_mode,
                },
                head=head,
            )
            return

        if not self._acquire_admission():
            await self._send_json(
                send,
                status=503,
                payload={"success": False, "error": "request body admission capacity exhausted"},
                head=head,
            )
            return
        deadline = time.monotonic() + self.total_timeout_seconds
        buffered: list[dict[str, Any]] = []
        observed = 0
        retained = 0
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise asyncio.TimeoutError
                message = await asyncio.wait_for(
                    receive(),
                    timeout=min(self.idle_timeout_seconds, remaining),
                )
                if message.get("type") != "http.request":
                    buffered.append(message)
                    break
                body = bytes(message.get("body") or b"")
                observed += len(body)
                if observed > self.max_body_bytes:
                    await self._send_json(
                        send,
                        status=413,
                        payload={"success": False, "error": "request body exceeds configured limit"},
                        head=head,
                    )
                    self._release_admission(retained)
                    return
                if body and not self._reserve_buffer(len(body)):
                    await self._send_json(
                        send,
                        status=503,
                        payload={"success": False, "error": "aggregate request body buffer exhausted"},
                        head=head,
                    )
                    self._release_admission(retained)
                    return
                retained += len(body)
                buffered.append({**message, "body": body})
                if not message.get("more_body", False):
                    break

            if declared is not None and observed != declared:
                await self._send_json(
                    send,
                    status=400,
                    payload={"success": False, "error": "Content-Length does not match request body"},
                    head=head,
                )
                self._release_admission(retained)
                return
        except asyncio.TimeoutError:
            try:
                await self._send_json(
                    send,
                    status=408,
                    payload={"success": False, "error": "request body acquisition timed out"},
                    head=head,
                )
            finally:
                self._release_admission(retained)
            return
        except BaseException:
            self._release_admission(retained)
            raise
        try:
            state = scope.setdefault("state", {})
            state["cortex_request_body_bytes"] = observed
            iterator = iter(buffered)

            async def replay_receive() -> dict[str, Any]:
                try:
                    return next(iterator)
                except StopIteration:
                    return await receive()

            await self.app(scope, replay_receive, send)
        finally:
            self._release_admission(retained)
