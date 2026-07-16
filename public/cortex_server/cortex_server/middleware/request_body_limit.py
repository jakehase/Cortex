"""Outer ASGI request-body admission control.

The limiter consumes an HTTP request body before dispatching it.  This keeps
chunked requests from reaching parsers or handlers until their complete size
has been proven to be within the configured bound.
"""

from __future__ import annotations

import json
from typing import Any


DEFAULT_MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024


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
    """Reject oversized declared and streamed HTTP request bodies with 413."""

    def __init__(self, app: Any, *, max_body_bytes: int = DEFAULT_MAX_REQUEST_BODY_BYTES):
        if int(max_body_bytes) <= 0:
            raise ValueError("max_body_bytes must be positive")
        self.app = app
        self.max_body_bytes = int(max_body_bytes)

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
        ]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": b"" if head else encoded})

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

        buffered: list[dict[str, Any]] = []
        observed = 0
        while True:
            message = await receive()
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
                return
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
            return

        state = scope.setdefault("state", {})
        state["cortex_request_body_bytes"] = observed
        iterator = iter(buffered)

        async def replay_receive() -> dict[str, Any]:
            try:
                return next(iterator)
            except StopIteration:
                return await receive()

        await self.app(scope, replay_receive, send)
