"""Fail-closed outbound HTTP policy and transport.

Every capability owns a server-side hostname allowlist.  Validation resolves
all DNS answers, rejects any non-global address, and pins the selected address
for the actual connection.  Redirects are followed only after repeating the
same validation.  Callers may narrow a policy, but cannot add destinations.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import ipaddress
import json as json_module
import os
import socket
import threading
import time
from typing import Any, Callable, Mapping, Optional, Sequence
from urllib.parse import urljoin, urlsplit

import httpx

MAX_URL_LENGTH = 8_192
DEFAULT_DNS_TIMEOUT_SECONDS = 5.0
DEFAULT_REQUEST_TIMEOUT_SECONDS = 10.0
DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
DEFAULT_MAX_REDIRECTS = 5
_DNS_WORKERS = 8
_DNS_ADMISSIONS = 16
_DNS_WORKER_SLOTS = threading.BoundedSemaphore(_DNS_WORKERS)
_DNS_ADMISSION_SLOTS = threading.BoundedSemaphore(_DNS_ADMISSIONS)
_DNS_TASKS: set[asyncio.Task] = set()
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
class EgressError(RuntimeError):
    """Base class for bounded outbound failures."""


class EgressPolicyError(EgressError):
    """A destination violates the configured outbound policy."""


class EgressCapacityError(EgressError):
    """A bounded egress resource is temporarily unavailable."""


class EgressUpstreamError(EgressError):
    """The remote endpoint did not produce a usable response."""


class EgressResponseTooLarge(EgressError):
    """The remote response exceeded the configured byte bound."""


def _canonical_hostname(value: str) -> str:
    hostname = str(value or "").strip().rstrip(".")
    if not hostname or len(hostname) > 253:
        raise EgressPolicyError("destination hostname is invalid")
    try:
        return hostname.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise EgressPolicyError("destination hostname is invalid") from exc


def _canonical_rule(value: str) -> str:
    rule = str(value or "").strip().rstrip(".").lower()
    wildcard = rule.startswith("*.")
    if wildcard:
        rule = rule[2:]
    if not rule or rule == "*" or "://" in rule or "/" in rule or ":" in rule:
        raise EgressPolicyError("egress allowlist contains an invalid hostname rule")
    canonical = _canonical_hostname(rule)
    return f"*.{canonical}" if wildcard else canonical


@dataclass(frozen=True)
class EgressPolicy:
    capability: str
    allowed_hosts: tuple[str, ...]

    @classmethod
    def from_environment(
        cls,
        capability: str,
        environ: Optional[Mapping[str, str]] = None,
    ) -> "EgressPolicy":
        normalized = str(capability or "").strip().upper().replace("-", "_")
        if not normalized or not normalized.replace("_", "").isalnum():
            raise EgressPolicyError("egress capability name is invalid")
        source = os.environ if environ is None else environ
        variable = f"CORTEX_{normalized}_EGRESS_ALLOWED_HOSTS"
        raw = str(source.get(variable, "") or "")
        rules = tuple(
            dict.fromkeys(
                _canonical_rule(part)
                for part in raw.split(",")
                if part.strip()
            )
        )
        return cls(capability=normalized.lower(), allowed_hosts=rules)

    def permits_hostname(self, hostname: str) -> bool:
        candidate = _canonical_hostname(hostname)
        for rule in self.allowed_hosts:
            if rule.startswith("*."):
                suffix = rule[2:]
                if candidate.endswith(f".{suffix}"):
                    return True
            elif candidate == rule:
                return True
        return False


@dataclass(frozen=True)
class ValidatedDestination:
    original_url: str
    pinned_url: str
    hostname: str
    host_header: str
    sni_hostname: str
    origin: tuple[str, str, int]


@dataclass(frozen=True)
class EgressResponse:
    status_code: int
    body: bytes
    headers: Mapping[str, str]
    final_url: str

    @property
    def text(self) -> str:
        content_type = str(self.headers.get("content-type", ""))
        encoding = "utf-8"
        for item in content_type.split(";")[1:]:
            key, separator, value = item.strip().partition("=")
            if separator and key.lower() == "charset" and value.strip():
                encoding = value.strip().strip('"')
                break
        try:
            return self.body.decode(encoding, errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json_module.loads(self.body)


def _track_dns_task(task: asyncio.Task) -> asyncio.Task:
    _DNS_TASKS.add(task)

    def finished(done: asyncio.Task) -> None:
        _DNS_TASKS.discard(done)
        if not done.cancelled():
            done.exception()

    task.add_done_callback(finished)
    return task


async def _resolve_all(
    hostname: str,
    port: int,
    *,
    deadline: float,
) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]:
    if not _DNS_ADMISSION_SLOTS.acquire(blocking=False):
        raise EgressCapacityError("DNS resolution capacity exhausted")

    acquired_worker = False

    def resolve() -> Sequence[tuple[Any, ...]]:
        nonlocal acquired_worker
        try:
            remaining = max(0.0, deadline - time.monotonic())
            if not _DNS_WORKER_SLOTS.acquire(timeout=remaining):
                raise EgressCapacityError("DNS resolution capacity exhausted")
            acquired_worker = True
            return socket.getaddrinfo(hostname, port, 0, socket.SOCK_STREAM)
        finally:
            if acquired_worker:
                _DNS_WORKER_SLOTS.release()
            _DNS_ADMISSION_SLOTS.release()

    task = _track_dns_task(asyncio.create_task(asyncio.to_thread(resolve)))
    try:
        answers = await asyncio.wait_for(
            asyncio.shield(task), max(0.0, deadline - time.monotonic())
        )
    except asyncio.TimeoutError as exc:
        raise EgressUpstreamError("destination DNS resolution timed out") from exc
    except EgressCapacityError:
        raise
    except OSError as exc:
        raise EgressUpstreamError("destination hostname could not be resolved") from exc

    resolved: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for answer in answers:
        try:
            address = ipaddress.ip_address(str(answer[4][0]).split("%", 1)[0])
        except (IndexError, TypeError, ValueError) as exc:
            raise EgressUpstreamError("destination DNS answer is invalid") from exc
        if address not in resolved:
            resolved.append(address)
    if not resolved:
        raise EgressUpstreamError("destination hostname could not be resolved")
    if any(not address.is_global for address in resolved):
        raise EgressPolicyError("destination resolves to a non-global address")
    return tuple(resolved)


async def validate_destination(
    value: str,
    policy: EgressPolicy,
    *,
    deadline: Optional[float] = None,
) -> ValidatedDestination:
    url = str(value or "").strip()
    if not url or len(url) > MAX_URL_LENGTH or any(ord(char) < 32 for char in url):
        raise EgressPolicyError("destination URL is invalid")
    try:
        parsed = urlsplit(url)
        hostname = _canonical_hostname(parsed.hostname or "")
        port = parsed.port
    except ValueError as exc:
        raise EgressPolicyError("destination URL is invalid") from exc
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.netloc:
        raise EgressPolicyError("only HTTP(S) destinations are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise EgressPolicyError("destination credentials are not allowed")
    if not policy.permits_hostname(hostname):
        raise EgressPolicyError("destination hostname is not server-authorized")

    resolved_port = port or (443 if scheme == "https" else 80)
    resolved_deadline = deadline or (time.monotonic() + DEFAULT_DNS_TIMEOUT_SECONDS)
    addresses = await _resolve_all(hostname, resolved_port, deadline=resolved_deadline)
    selected = addresses[0]
    literal = f"[{selected}]" if selected.version == 6 else str(selected)
    pinned_netloc = f"{literal}:{port}" if port is not None else literal
    host_literal = f"[{hostname}]" if ":" in hostname else hostname
    default_port = 443 if scheme == "https" else 80
    host_header = (
        f"{host_literal}:{port}"
        if port is not None and port != default_port
        else host_literal
    )
    normalized = parsed._replace(
        scheme=scheme,
        netloc=pinned_netloc,
        fragment="",
    )
    original = parsed._replace(scheme=scheme, fragment="").geturl()
    return ValidatedDestination(
        original_url=original,
        pinned_url=normalized.geturl(),
        hostname=hostname,
        host_header=host_header,
        sni_hostname=hostname,
        origin=(scheme, hostname, resolved_port),
    )


def _bounded_timeout(value: float) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError) as exc:
        raise EgressPolicyError("outbound timeout is invalid") from exc
    if timeout <= 0 or timeout > 120:
        raise EgressPolicyError("outbound timeout is outside the allowed range")
    return timeout


async def request(
    method: str,
    url: str,
    *,
    policy: EgressPolicy,
    headers: Optional[Mapping[str, str]] = None,
    params: Optional[Mapping[str, Any]] = None,
    json: Any = None,
    content: Optional[bytes] = None,
    timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    destination_guard: Optional[Callable[[ValidatedDestination], None]] = None,
) -> EgressResponse:
    normalized_method = str(method or "").strip().upper()
    if normalized_method not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}:
        raise EgressPolicyError("outbound method is not allowed")
    timeout_seconds = _bounded_timeout(timeout)
    if not isinstance(max_response_bytes, int) or not 0 < max_response_bytes <= 10_000_000:
        raise EgressPolicyError("outbound response byte limit is invalid")
    if not isinstance(max_redirects, int) or not 0 <= max_redirects <= 10:
        raise EgressPolicyError("outbound redirect limit is invalid")

    current_url = str(url or "")
    current_method = normalized_method
    current_headers = {
        str(key): str(value)
        for key, value in (headers or {}).items()
        if str(key).lower() != "host"
    }
    current_params = params
    current_json = json
    current_content = content
    previous_origin: Optional[tuple[str, str, int]] = None
    deadline = time.monotonic() + timeout_seconds

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,
        trust_env=False,
    ) as client:
        for redirect_count in range(max_redirects + 1):
            if time.monotonic() >= deadline:
                raise EgressUpstreamError("outbound request timed out")
            destination = await validate_destination(
                current_url,
                policy,
                deadline=deadline,
            )
            if destination_guard is not None:
                destination_guard(destination)
            if previous_origin is not None and destination.origin != previous_origin:
                # A capability admits the caller-selected origin, not an
                # arbitrary second sink chosen by that origin.  In
                # particular, never forward a mutating request or a request
                # body across origins after a 307/308 (or a non-POST
                # 301/302).  Credential stripping alone cannot prevent the
                # payload itself from being exfiltrated.
                if (
                    current_method in {"POST", "PUT", "PATCH", "DELETE"}
                    or current_json is not None
                    or current_content is not None
                ):
                    raise EgressPolicyError(
                        "cross-origin redirect cannot forward a request body"
                    )
                # Header names are attacker-controlled too: an opaque secret
                # under an unfamiliar name cannot be classified safely.  A
                # cross-origin redirect therefore receives no caller headers.
                current_headers = {}
            wire_headers = dict(current_headers)
            wire_headers["Host"] = destination.host_header
            extensions = {"sni_hostname": destination.sni_hostname.encode("idna")}
            try:
                # httpx's timeout covers individual socket operations.  The
                # outer absolute deadline additionally stops a slow-drip
                # peer whose chunks each arrive just inside that timeout.
                async with asyncio.timeout(max(0.0, deadline - time.monotonic())):
                    async with client.stream(
                        current_method,
                        destination.pinned_url,
                        headers=wire_headers,
                        params=current_params,
                        json=current_json,
                        content=current_content,
                        extensions=extensions,
                    ) as response:
                        location = response.headers.get("location")
                        if response.status_code in _REDIRECT_STATUSES:
                            if not location:
                                raise EgressUpstreamError("upstream redirect is missing a location")
                            if redirect_count >= max_redirects:
                                raise EgressUpstreamError("too many upstream redirects")
                            previous_origin = destination.origin
                            current_url = urljoin(destination.original_url, location)
                            current_params = None
                            if response.status_code == 303 or (
                                response.status_code in {301, 302} and current_method == "POST"
                            ):
                                current_method = "GET"
                                current_json = None
                                current_content = None
                                current_headers = {
                                    key: value
                                    for key, value in current_headers.items()
                                    if key.lower() not in {"content-length", "content-type"}
                                }
                            continue

                        declared = response.headers.get("content-length")
                        if declared is not None:
                            try:
                                if int(declared) > max_response_bytes:
                                    raise EgressResponseTooLarge(
                                        "upstream response exceeds the byte limit"
                                    )
                            except ValueError as exc:
                                raise EgressUpstreamError(
                                    "upstream content length is invalid"
                                ) from exc
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(body) + len(chunk) > max_response_bytes:
                                raise EgressResponseTooLarge(
                                    "upstream response exceeds the byte limit"
                                )
                            body.extend(chunk)
                        return EgressResponse(
                            status_code=response.status_code,
                            body=bytes(body),
                            headers=dict(response.headers),
                            final_url=destination.original_url,
                        )
            except EgressError:
                raise
            except (asyncio.TimeoutError, TimeoutError) as exc:
                raise EgressUpstreamError("outbound request timed out") from exc
            except httpx.TimeoutException as exc:
                raise EgressUpstreamError("outbound request timed out") from exc
            except httpx.RequestError as exc:
                raise EgressUpstreamError("outbound request failed") from exc

    raise EgressUpstreamError("outbound request did not complete")


__all__ = [
    "DEFAULT_MAX_RESPONSE_BYTES",
    "EgressCapacityError",
    "EgressError",
    "EgressPolicy",
    "EgressPolicyError",
    "EgressResponse",
    "EgressResponseTooLarge",
    "EgressUpstreamError",
    "ValidatedDestination",
    "request",
    "validate_destination",
]
