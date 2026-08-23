"""Bounded redaction for values crossing response, trace, or persistence boundaries."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


REDACTION_MARKER = "[REDACTED]"
TRUNCATION_MARKER = "[TRUNCATED]"
DEFAULT_MAX_DEPTH = 12
DEFAULT_MAX_ITEMS = 4096
DEFAULT_MAX_QUERY_CHARS = 8192
DEFAULT_MAX_QUERY_FIELDS = 64
DEFAULT_MAX_URL_DEPTH = 4

# Exact allow entries prevent identifier/telemetry fields from being caught by
# deliberately conservative credential hints. This list is intentionally
# bounded: an unknown credential-looking field fails closed.
SAFE_FIELD_ALLOWLIST = frozenset(
    {
        "event_id",
        "objective_key",
        "process_id",
        "request_id",
        "schema_version",
        "scope_tag",
        "status_code",
        "token_count",
        "input_tokens",
        "output_tokens",
        "total_tokens",
    }
)

# The generic retention helper is deliberately metadata-only.  Callers that
# construct a larger safe schema must pass an explicit ``allowed_fields`` set;
# an unknown key is never evidence that its opaque value is safe to persist.
DEFAULT_RETENTION_FIELD_ALLOWLIST = SAFE_FIELD_ALLOWLIST | frozenset(
    {
        "body_bytes",
        "body_sha256",
        "configured",
        "content_hash",
        "content_sha256",
        "count",
        "duration_ms",
        "error_type",
        "field_count",
        "kind",
        "latency_ms",
        "ok",
        "outcome",
        "ready",
        "response_bytes",
        "response_sha256",
        "status",
        "success",
        "timestamp",
        "ts",
        "ts_unix",
    }
)

SAFE_HEADER_ALLOWLIST = frozenset(
    {
        "x_cortex_read_authorization_mode",
        "x_cortex_write_authorization_mode",
        "x_cortex_read_admin_required",
        "x_cortex_principal_scope_required",
    }
)

SENSITIVE_FIELD_DENYLIST = frozenset(
    {
        "authorization",
        "proxy_authorization",
        "authentication",
        "cookie",
        "set_cookie",
        "password",
        "passwd",
        "secret",
        "client_secret",
        "private_key",
        "api_key",
        "apikey",
        "access_key",
        "access_token",
        "refresh_token",
        "bearer_token",
        "credential",
        "credentials",
        "signature",
        "session_key",
        "x_cortex_session_key",
        "x_cortex_execution_capability",
    }
)

PHI_FIELD_DENYLIST = frozenset(
    {
        "ssn",
        "social_security_number",
        "patient",
        "patient_id",
        "patient_name",
        "patient_email",
        "patient_phone",
        "medical_record_number",
        "medical_history",
        "health_record",
        "insurance_id",
        "diagnosis",
        "diagnoses",
        "prescription",
        "date_of_birth",
        "dob",
        "email",
        "email_address",
        "phone",
        "phone_number",
        "street_address",
        "home_address",
    }
)

# These names conventionally contain attacker-controlled bodies, tool output,
# model traces, or exception text.  Pattern matching cannot prove that an
# opaque value in one of these fields is safe, so retention/log sanitization
# drops the value by default.  Callers that need durable diagnostics should
# persist explicit metadata (byte counts, hashes, status codes, and error
# classes) beside the redacted field.
RAW_CONTENT_FIELD_DENYLIST = frozenset(
    {
        "body",
        "body_text",
        "chunk",
        "command_output",
        "command_result",
        "error",
        "error_detail",
        "exception",
        "excerpt",
        "input",
        "model_input",
        "model_output",
        "output",
        "query",
        "raw",
        "raw_body",
        "request_body",
        "response",
        "response_body",
        "result",
        "stderr",
        "stderr_tail",
        "stdout",
        "stdout_tail",
        "thought",
        "tool_output",
        "traceback",
        "upstream_body",
        "upstream_response",
    }
)

_CREDENTIAL_PARTS = frozenset(
    {
        "auth",
        "authorization",
        "authentication",
        "bearer",
        "cookie",
        "credential",
        "credentials",
        "password",
        "passwd",
        "secret",
        "signature",
        "token",
    }
)
_CORTEX_CREDENTIAL_PARTS = _CREDENTIAL_PARTS | {"capability"}
_QUERY_SENSITIVE_PARTS = (
    "token",
    "secret",
    "password",
    "signature",
    "credential",
    "api_key",
    "apikey",
    "key",
    "auth",
)

# Query telemetry is an allowlist, not a blocklist.  Values outside these
# small operational vocabularies are retained only as a redaction marker.
# Empty values contain no user data and are safe for cardinality/debugging.
_SAFE_QUERY_ENUM_VALUES = {
    "format": frozenset({"csv", "html", "json", "text"}),
    "mode": frozenset({"compact", "detail", "full", "read", "summary", "write"}),
    "order": frozenset({"asc", "desc"}),
    "status": frozenset(
        {"active", "complete", "disabled", "enabled", "error", "failed", "ok", "pending", "running"}
    ),
    "view": frozenset({"compact", "detail", "full", "summary"}),
}
_SAFE_QUERY_BOOLEAN_KEYS = frozenset(
    {"active", "enabled", "include", "ok", "recursive", "verbose"}
)
_SAFE_QUERY_BOOLEAN_VALUES = frozenset({"0", "1", "false", "no", "true", "yes"})
_SAFE_QUERY_INTEGER_KEYS = frozenset(
    {"limit", "offset", "page", "per_page", "size", "version"}
)
_URL_QUERY_KEYS = frozenset(
    {
        "callback",
        "continue",
        "destination",
        "next",
        "redirect",
        "redirect_uri",
        "return_to",
        "target",
        "url",
    }
)

_AUTH_ASSIGNMENT_RE = re.compile(
    r"\b((?:proxy[-_ ]?)?authorization|authentication)\s*[:=]\s*"
    r"(?:(?:bearer|basic)\s+)?[^\s,;]+",
    re.IGNORECASE,
)
_BEARER_VALUE_RE = re.compile(
    r"\bBearer\s+[^\s,;]+",
    re.IGNORECASE,
)
_BASIC_VALUE_RE = re.compile(
    r"\bBasic\s+[A-Za-z0-9+/]{2,}={0,2}",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?P<prefix>[\"']?(?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|"
    r"client[_-]?secret|password|passwd|secret|token|credential|signature)[\"']?\s*[:=]\s*)"
    r"(?P<quote>[\"']?)(?P<value>[^\s&,;\"']+)(?P=quote)",
    re.IGNORECASE,
)
_PHI_ASSIGNMENT_RE = re.compile(
    r"(?P<prefix>[\"']?(?:patient[_-]?(?:name|id|email|phone)|medical[_-]?record[_-]?number|"
    r"mrn|ssn|social[_-]?security[_-]?number|diagnosis|date[_-]?of[_-]?birth|dob|"
    r"email|phone(?:[_-]?number)?)[\"']?\s*[:=]\s*)"
    r"(?P<value>[^,;\n]+)",
    re.IGNORECASE,
)
_SECRET_VALUE_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
)
_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_CREDENTIAL_LIKE_RE = re.compile(r"[A-Za-z0-9_-]{24,}")


def _normalize_key(key: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(key or "").strip().lower()).strip("_")


def _key_parts(normalized: str) -> Set[str]:
    return {part for part in normalized.split("_") if part}


def is_sensitive_field(key: Any, *, header: bool = False) -> bool:
    """Return whether a field name denotes a credential or PHI-like value."""
    normalized = _normalize_key(key)
    if header and normalized in SAFE_HEADER_ALLOWLIST:
        return False
    if normalized in SAFE_FIELD_ALLOWLIST:
        return False
    if normalized in SENSITIVE_FIELD_DENYLIST or normalized in PHI_FIELD_DENYLIST:
        return True
    parts = _key_parts(normalized)
    if normalized.endswith(
        (
            "_api_key",
            "_private_key",
            "_access_key",
            "_signing_key",
            "_encryption_key",
            "_hmac_key",
            "_session_key",
        )
    ):
        return True
    if parts & _CREDENTIAL_PARTS:
        return True
    if header and normalized.startswith(("x_cortex_action_", "x_action_")):
        return True
    if normalized.startswith(("x_cortex_", "x_action_", "x_admin_")) and parts & _CORTEX_CREDENTIAL_PARTS:
        return True
    if normalized.startswith(("patient_", "medical_", "health_", "insurance_")):
        return True
    return False


def is_sensitive_query_key(key: str) -> bool:
    normalized = str(key or "").lower().replace("-", "_")
    return normalized == "sig" or any(part in normalized for part in _QUERY_SENSITIVE_PARTS)


def redact_url_query_value(
    value: str,
    *,
    depth: int = 0,
    max_chars: int = DEFAULT_MAX_QUERY_CHARS,
    max_fields: int = DEFAULT_MAX_QUERY_FIELDS,
    max_depth: int = DEFAULT_MAX_URL_DEPTH,
    marker: str = REDACTION_MARKER,
) -> str:
    """Redact credentials in the query component of a URL-valued field."""
    leading_controls_and_space = "".join(chr(codepoint) for codepoint in range(0x21))
    normalized_value = str(value or "").lstrip(leading_controls_and_space)
    lowered_value = normalized_value.lower()
    is_http_url = False
    if lowered_value.startswith(("http:", "https:")):
        expected_prefix = "https://" if lowered_value.startswith("https:") else "http://"
        authority = normalized_value[len(expected_prefix):]
        if not lowered_value.startswith(expected_prefix) or not authority or authority[0] in {"/", "\\"}:
            return marker
        is_http_url = True
    elif normalized_value.startswith("//"):
        if len(normalized_value) == 2 or normalized_value[2] in {"/", "\\"}:
            return marker
        is_http_url = True
    is_relative_url = normalized_value.startswith("/") and not normalized_value.startswith("//")
    if not is_http_url and not is_relative_url:
        # URL-valued telemetry is useful only when it is unambiguously an HTTP
        # URL or an absolute-path reference.  Opaque callback codes and custom
        # connection schemes are never retained.
        return marker
    if "\\" in normalized_value or any(ord(character) <= 0x20 for character in normalized_value):
        return marker
    try:
        parsed = urlsplit(normalized_value)
    except ValueError:
        return marker
    if is_http_url:
        if not parsed.netloc or parsed.hostname is None or parsed.username is not None or parsed.password is not None:
            return marker
    elif parsed.scheme or parsed.netloc:
        return marker
    if not parsed.query:
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    if depth >= max_depth:
        return marker
    if len(parsed.query) > max_chars or parsed.query.count("&") + 1 > max_fields:
        return marker
    query = redact_query_string(
        parsed.query,
        depth=depth + 1,
        max_chars=max_chars,
        max_fields=max_fields,
        max_depth=max_depth,
        marker=marker,
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, ""))


def redact_query_string(
    query: str,
    *,
    depth: int = 0,
    max_chars: int = DEFAULT_MAX_QUERY_CHARS,
    max_fields: int = DEFAULT_MAX_QUERY_FIELDS,
    max_depth: int = DEFAULT_MAX_URL_DEPTH,
    marker: str = REDACTION_MARKER,
    limit_marker: str = TRUNCATION_MARKER,
) -> str:
    """Return a bounded query string with secret values removed."""
    raw = str(query or "")
    if not raw:
        return ""
    if len(raw) > max_chars or raw.count("&") + 1 > max_fields:
        return limit_marker
    try:
        parsed = parse_qsl(raw, keep_blank_values=True, max_num_fields=max_fields)
    except ValueError:
        return limit_marker
    pairs = []
    for key, value in parsed:
        normalized = _normalize_key(key)
        if is_sensitive_query_key(key):
            value = marker
        elif value == "":
            # The parameter name is useful operational metadata; an empty
            # value contains no caller-controlled content to retain.
            value = ""
        elif normalized in _URL_QUERY_KEYS:
            value = redact_url_query_value(
                value,
                depth=depth,
                max_chars=max_chars,
                max_fields=max_fields,
                max_depth=max_depth,
                marker=marker,
            )
        elif normalized in _SAFE_QUERY_ENUM_VALUES:
            if value.lower() not in _SAFE_QUERY_ENUM_VALUES[normalized]:
                value = marker
        elif normalized in _SAFE_QUERY_BOOLEAN_KEYS:
            if value.lower() not in _SAFE_QUERY_BOOLEAN_VALUES:
                value = marker
        elif normalized in _SAFE_QUERY_INTEGER_KEYS:
            if not re.fullmatch(r"\d{1,9}", value):
                value = marker
        else:
            value = marker
        pairs.append((key, value))
    return urlencode(pairs)


def _redact_url_match(match: re.Match[str]) -> str:
    raw = match.group(0)
    core = raw.rstrip(".,);]")
    suffix = raw[len(core):]
    return redact_url_query_value(core) + suffix


def redact_sensitive_text(value: Any, *, max_chars: Optional[int] = None) -> str:
    """Redact inline credential/PHI forms without emitting the original value."""
    text = str(value or "").replace("\x00", "")
    text = _URL_RE.sub(_redact_url_match, text)
    text = _AUTH_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}={REDACTION_MARKER}", text)
    # Scheme credentials also occur in stdout, upstream bodies, and exception
    # text without an ``Authorization:`` label. Redact those before assignment
    # matching so ``token: Bearer <value>`` cannot leave the value behind.
    text = _BEARER_VALUE_RE.sub(REDACTION_MARKER, text)
    text = _BASIC_VALUE_RE.sub(REDACTION_MARKER, text)
    text = _SECRET_ASSIGNMENT_RE.sub(
        lambda match: f"{match.group('prefix')}{REDACTION_MARKER}", text
    )
    text = _PHI_ASSIGNMENT_RE.sub(
        lambda match: f"{match.group('prefix')}{REDACTION_MARKER}", text
    )
    for pattern in _SECRET_VALUE_PATTERNS:
        text = pattern.sub(REDACTION_MARKER, text)
    if max_chars is not None and len(text) > max(1, int(max_chars)):
        limit = max(1, int(max_chars))
        return text[: max(1, limit - 1)] + "…"
    return text


class _RedactionState:
    def __init__(self, *, max_items: int) -> None:
        self.max_items = max(1, int(max_items))
        self.items = 0
        self.redacted_fields: List[str] = []
        self.highest_sensitivity = "public_safe"
        self.seen: Set[int] = set()

    def visit(self) -> bool:
        self.items += 1
        return self.items <= self.max_items

    def note_string(self, value: str) -> None:
        if self.highest_sensitivity == "public_safe":
            self.highest_sensitivity = "operator_safe"
        if len(value) > 40 and _CREDENTIAL_LIKE_RE.search(value):
            if self.highest_sensitivity in {"public_safe", "operator_safe"}:
                self.highest_sensitivity = "credential_like"

    def note_redaction(self, path: str) -> None:
        if len(self.redacted_fields) < 64:
            self.redacted_fields.append(path or "value")
        self.highest_sensitivity = "secret_never_display"


def redact_sensitive_data_with_metadata(
    value: Any,
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
    max_items: int = DEFAULT_MAX_ITEMS,
    max_string_chars: Optional[int] = None,
    allowed_fields: Optional[Iterable[str]] = None,
    allowed_headers: Optional[Iterable[str]] = None,
    allowed_sensitive_containers: Optional[Iterable[str]] = None,
    allow_root_scalar: bool = False,
) -> Tuple[Any, Dict[str, Any]]:
    """Recursively retain only allowlisted metadata under resource bounds.

    ``allowed_sensitive_containers`` is an exact, caller-scoped exception for
    known structural objects whose names are conservatively credential-like
    (for example, a boolean authorization decision summary). Scalar values
    never receive this exception, and nested fields remain independently
    subject to the sensitive-field and retention allowlists.
    """
    state = _RedactionState(max_items=max_items)
    retained_fields = frozenset(
        _normalize_key(field)
        for field in (
            DEFAULT_RETENTION_FIELD_ALLOWLIST
            if allowed_fields is None
            else allowed_fields
        )
    )
    retained_headers = frozenset(
        _normalize_key(field)
        for field in (
            SAFE_HEADER_ALLOWLIST
            if allowed_headers is None
            else allowed_headers
        )
    )
    retained_sensitive_containers = frozenset(
        _normalize_key(field) for field in (allowed_sensitive_containers or ())
    )

    def walk(
        node: Any,
        path: str,
        depth: int,
        *,
        header_context: bool = False,
        scalar_allowed: bool = False,
    ) -> Any:
        if not state.visit():
            state.note_redaction(path)
            return TRUNCATION_MARKER
        if depth > max(1, int(max_depth)):
            state.note_redaction(path)
            return TRUNCATION_MARKER
        if isinstance(node, Mapping):
            identity = id(node)
            if identity in state.seen:
                state.note_redaction(path)
                return TRUNCATION_MARKER
            state.seen.add(identity)
            try:
                out: Dict[str, Any] = {}
                for key, child in node.items():
                    key_text = str(key)
                    child_path = f"{path}.{key_text}" if path else key_text
                    normalized = _normalize_key(key_text)
                    if normalized in RAW_CONTENT_FIELD_DENYLIST:
                        state.note_redaction(child_path)
                        out[key_text] = REDACTION_MARKER
                        continue
                    if is_sensitive_field(key_text, header=header_context) and not (
                        normalized in retained_sensitive_containers
                        and isinstance(child, Mapping)
                    ):
                        state.note_redaction(child_path)
                        out[key_text] = REDACTION_MARKER
                        continue
                    active_allowlist = retained_headers if header_context else retained_fields
                    if normalized not in active_allowlist:
                        state.note_redaction(child_path)
                        out[key_text] = REDACTION_MARKER
                        continue
                    out[key_text] = walk(
                        child,
                        child_path,
                        depth + 1,
                        header_context=header_context
                        or normalized in {"headers", "request_headers", "response_headers"},
                        scalar_allowed=True,
                    )
                return out
            finally:
                state.seen.discard(identity)
        if isinstance(node, (list, tuple, set, frozenset)):
            identity = id(node)
            if identity in state.seen:
                state.note_redaction(path)
                return TRUNCATION_MARKER
            state.seen.add(identity)
            try:
                return [
                    walk(
                        item,
                        f"{path}[{index}]",
                        depth + 1,
                        header_context=header_context,
                        scalar_allowed=scalar_allowed,
                    )
                    for index, item in enumerate(node)
                ]
            finally:
                state.seen.discard(identity)
        if isinstance(node, str):
            if not scalar_allowed:
                state.note_redaction(path)
                return REDACTION_MARKER
            state.note_string(node)
            redacted = redact_sensitive_text(node, max_chars=max_string_chars)
            if redacted != node.replace("\x00", ""):
                state.note_redaction(path)
            return redacted
        if isinstance(node, bytes):
            if not scalar_allowed:
                state.note_redaction(path)
                return REDACTION_MARKER
            decoded = node.decode("utf-8", errors="replace")
            redacted = redact_sensitive_text(decoded, max_chars=max_string_chars)
            if redacted != decoded:
                state.note_redaction(path)
            return redacted
        if node is None or isinstance(node, (bool, int, float)):
            if scalar_allowed:
                return node
            state.note_redaction(path)
            return REDACTION_MARKER
        if not scalar_allowed:
            state.note_redaction(path)
            return REDACTION_MARKER
        rendered = str(node)
        state.note_string(rendered)
        redacted = redact_sensitive_text(rendered, max_chars=max_string_chars)
        if redacted != rendered:
            state.note_redaction(path)
        return redacted

    redacted = walk(value, "", 0, scalar_allowed=bool(allow_root_scalar))
    return redacted, {
        "redacted_field_count": len(state.redacted_fields),
        "redacted_fields": list(state.redacted_fields),
        "highest_sensitivity": state.highest_sensitivity,
    }


def redact_sensitive_data(
    value: Any,
    *,
    max_depth: int = DEFAULT_MAX_DEPTH,
    max_items: int = DEFAULT_MAX_ITEMS,
    max_string_chars: Optional[int] = None,
    allowed_fields: Optional[Iterable[str]] = None,
    allowed_headers: Optional[Iterable[str]] = None,
    allowed_sensitive_containers: Optional[Iterable[str]] = None,
    allow_root_scalar: bool = False,
) -> Any:
    redacted, _metadata = redact_sensitive_data_with_metadata(
        value,
        max_depth=max_depth,
        max_items=max_items,
        max_string_chars=max_string_chars,
        allowed_fields=allowed_fields,
        allowed_headers=allowed_headers,
        allowed_sensitive_containers=allowed_sensitive_containers,
        allow_root_scalar=allow_root_scalar,
    )
    return redacted


def redact_headers(headers: Any, *, max_value_chars: Optional[int] = 200) -> Dict[str, str]:
    """Retain only explicitly safe metadata headers; redact every other value."""
    if not isinstance(headers, Mapping):
        return {}
    out: Dict[str, str] = {}
    for key, value in headers.items():
        key_text = str(key)
        if (
            is_sensitive_field(key_text, header=True)
            or _normalize_key(key_text) not in SAFE_HEADER_ALLOWLIST
        ):
            out[key_text] = REDACTION_MARKER
        else:
            out[key_text] = redact_sensitive_text(value, max_chars=max_value_chars)
    return out


__all__ = [
    "REDACTION_MARKER",
    "TRUNCATION_MARKER",
    "DEFAULT_RETENTION_FIELD_ALLOWLIST",
    "RAW_CONTENT_FIELD_DENYLIST",
    "is_sensitive_field",
    "is_sensitive_query_key",
    "redact_headers",
    "redact_query_string",
    "redact_sensitive_data",
    "redact_sensitive_data_with_metadata",
    "redact_sensitive_text",
    "redact_url_query_value",
]
