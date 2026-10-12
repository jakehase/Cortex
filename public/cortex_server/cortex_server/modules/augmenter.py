"""Level 38: Augmenter — output-contract detection, validation and repair.

Deterministic core shared by ``routers/augmenter.py`` and the ExecutionEngine
adapter:

* ``classify_kind`` infers the output contract a request asks for
  (``tool_json``, ``choice_letter``, ``numeric``, ``code``, ``freeform``);
* ``validate`` checks an answer against that contract (JSON object with
  ``function``/``arguments``; a single letter; a stated number; Python that
  parses; ``freeform`` has no contract and is reported as such);
* citation helpers report which requested ``Source: path#Lx`` citations are
  missing from an answer. Nothing is ever appended to an answer: a missing
  citation is a validation failure, not something to paste in;
* ``AugmenterStats`` keeps rolling, measured counters for the status endpoint.

The ``risk`` value is a routing heuristic (how hard to push validation),
labelled as such; it is not a risk assessment.
"""

from __future__ import annotations

import ast
import json
import os
import re
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

_STRICT_MARKERS = re.compile(
    r"\b(only|exactly|must|do not|dont|json|single|uppercase|lowercase|letter)\b",
    re.I,
)
CITATION_PATTERN = re.compile(r"Source:\s*([A-Za-z0-9_./-]+#L?\d+(?:-\d+)?)", re.I)

# Multi-word operational intents only; single common words such as "risk",
# "schema" or "database" no longer trigger the ops preflight.
OPS_INTENT_MARKERS = re.compile(
    r"\b(deploy(?:ing|ment)? to (?:prod|production|staging)|production (?:deploy(?:ment)?|rollout|release|migration|incident|outage)"
    r"|roll ?back (?:the|a|this)? ?(?:deploy(?:ment)?|release|migration)|rollback plan|incident (?:response|review|postmortem)"
    r"|database migration|schema migration|canary (?:release|rollout|deploy(?:ment)?)|blast radius|hotfix (?:to|in) prod(?:uction)?)\b",
    re.I,
)


def augmenter_enabled() -> bool:
    return os.getenv("AUGMENTER_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")


def classify_kind(prompt: str) -> str:
    p = (prompt or "").lower()
    # Quoted tool/JSON input is not an output-format instruction. Honor an
    # explicit prose request in the leading instruction before inspecting data.
    instruction = re.split(r"```|\{|\b(?:observation|input|data|context)\s*:", p, maxsplit=1)[0]
    prose_requested = bool(re.search(r"\b(?:one|single)\s+sentence\b|\bplain\s+(?:english|language)\b|\bin\s+prose\b", instruction))
    explicit_json_output = bool(re.search(
        r"\b(?:return|emit|output|produce|respond with|reply with)\s+(?:(?:only|strict|valid)\s+)?json\b|\b(?:as json|json only|no prose)\b", instruction))
    code_requested = bool(re.search(r"^\s*(?:please\s+)?(?:write|generate|implement|create)\s+(?:(?:a|an)\s+)?(?:(?:python|javascript|typescript|sql)\s+)?(?:function|class|script|program|code)\b", instruction))
    if prose_requested and not explicit_json_output and not code_requested:
        return "freeform"

    json_intent = any(k in p for k in ["json", "strict json", "valid json", "json only", "no prose", "no markdown"])
    tool_intent = any(k in p for k in ["tool", "tool call", "function", "function call", "invocation", "arguments", "args", "params", "parameters", "schema", "keys"])
    key_pair_hint = bool(
        re.search(
            r"keys?\s+['\"]?(tool|function|name)['\"]?\s*(?:and|,|&)\s*['\"]?(args|arguments|params|parameters)['\"]?",
            p,
            re.I,
        )
    )

    if json_intent and (tool_intent or key_pair_hint):
        return "tool_json"
    if "{" in p and "}" in p and any(k in p for k in ["json", "tool", "function", "arguments", "args", "params"]):
        return "tool_json"
    if "option" in p and any(x in p for x in ["a)", "b)", "c)", "d)"]):
        return "choice_letter"
    if "letter only" in p or "option letter" in p:
        return "choice_letter"
    if code_requested or any(w in p for w in ["write a function", "python code", "javascript code", "typescript code", "sql query"]):
        return "code"
    # A numeric contract needs both a calculation verb and numbers to work on.
    if re.search(r"\d", instruction) and re.search(
        r"\b(compute|calculate|solve|how many|area of|sum of|convert\s+-?\d)", instruction
    ):
        return "numeric"
    return "freeform"


def routing_risk(prompt: str, kind: str) -> float:
    """Heuristic for how strongly to validate/repair; not a risk assessment."""

    risk = 0.05 + {"tool_json": 0.35, "choice_letter": 0.25, "numeric": 0.25, "code": 0.15}.get(kind, 0.0)
    if _STRICT_MARKERS.search(prompt or ""):
        risk += 0.20
    n = len(prompt or "")
    risk += 0.15 if n > 800 else (0.08 if n > 300 else 0.0)
    return round(min(1.0, risk), 3)


def is_ops_intent(prompt: str) -> bool:
    return bool(OPS_INTENT_MARKERS.search(prompt or ""))


def extract_choice_letter(text: str) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"\b([ABCD])\b", text.strip().upper())
    return m.group(1) if m else None


def extract_json_obj(text: str) -> Optional[dict]:
    if not text:
        return None
    t = text.strip()
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except ValueError:
        pass
    m = re.search(r"\{[\s\S]*\}", t)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except ValueError:
        return None


_FENCE = re.compile(r"```([A-Za-z0-9_+-]*)[ \t]*\n(.*?)```", re.S)
_NUMBER = re.compile(r"(?<![A-Za-z])-?\d+(?:[.,]\d+)?")


def _wants_python(prompt: str) -> bool:
    p = (prompt or "").lower()
    return "python" in p or not any(lang in p for lang in ("javascript", "typescript", "sql", "bash", "rust", "java", "go ", "c++"))


def validate(kind: str, text: str, prompt: str = "") -> Tuple[bool, str]:
    """Check an answer against its output contract. Returns (ok, why)."""

    text = str(text or "")
    if kind == "choice_letter":
        letter = extract_choice_letter(text)
        if letter and text.strip().upper() == letter:
            return True, "ok"
        return (False, "format:must_be_single_letter") if letter else (False, "format:no_letter_found")

    if kind == "tool_json":
        obj = extract_json_obj(text)
        if not obj:
            return False, "format:invalid_json"
        if "function" not in obj or "arguments" not in obj:
            return False, "format:missing_keys"
        if not isinstance(obj.get("arguments"), dict):
            return False, "format:arguments_not_object"
        return True, "ok"

    if kind == "numeric":
        return (True, "ok") if _NUMBER.search(text) else (False, "format:no_number")

    if kind == "code":
        if not text.strip():
            return False, "format:empty_code"
        blocks = _FENCE.findall(text)
        if blocks:
            lang, body = blocks[0]
            is_python = lang.lower() in ("python", "py") or (not lang and _wants_python(prompt))
        else:
            body = text
            is_python = _wants_python(prompt)
        if not is_python:
            return True, "ok_unparsed_language"
        try:
            ast.parse(body)
            return True, "ok"
        except SyntaxError as exc:
            return False, f"syntax:python_invalid:line_{exc.lineno}"

    return True, "no_contract"


def normalize_citation(citation: str) -> str:
    return str(citation or "").strip().lower()


def requested_citations(prompt: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in CITATION_PATTERN.findall(prompt or ""):
        original = str(raw or "").strip()
        norm = normalize_citation(original)
        if norm and norm not in seen:
            seen.add(norm)
            out.append(original)
    return out


def answer_citations(text: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for c in (normalize_citation(x) for x in CITATION_PATTERN.findall(text or "")):
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def citation_gap(required: List[str], text: str) -> Tuple[bool, List[str], List[str]]:
    predicted = answer_citations(text)
    if not required:
        return True, [], predicted
    pred = set(predicted)
    missing = [c for c in required if normalize_citation(c) not in pred]
    return not missing, missing, predicted


def contract_guidance(kind: str, required: List[str]) -> str:
    text = {
        "tool_json": "The answer must be ONLY a JSON object with keys \"function\" (string) and \"arguments\" (object).",
        "choice_letter": "The answer must be a single option letter (A, B, C or D) and nothing else.",
        "numeric": "The answer must state the final numeric value explicitly (with its unit if relevant).",
        "code": "The answer must contain code that parses (one fenced block).",
        "freeform": "No strict output format was requested.",
    }.get(kind, "No strict output format was requested.")
    if required:
        text += " It must cite: " + ", ".join(f"Source: {c}" for c in required) + " — only if those sources actually support it."
    return text


def repair_prompt(kind: str, original_prompt: str, failure: str, model_answer: str, required: List[str]) -> str:
    if required and failure.startswith("citation"):
        req = " | ".join(f"Source: {c}" for c in required)
        return (
            "Answer the task again. Cite each required source exactly as written where it supports your answer; "
            "if a required source does not support the answer, say so instead of citing it.\n"
            f"Required citations: {req}\nTask: {original_prompt}\nPrevious output (for reference):\n{model_answer}"
        )
    if kind == "choice_letter":
        return f"Return ONLY a single letter: A, B, C, or D. No punctuation, no words.\nQuestion: {original_prompt}"
    if kind == "tool_json":
        return (
            "Return ONLY valid JSON. No markdown. Must be an object with keys: function (string) and arguments (object).\n"
            f"Validation failure: {failure}\nTask: {original_prompt}\nYour previous output (for reference):\n{model_answer}"
        )
    if kind == "numeric":
        return (
            "Answer again and state the final numeric value explicitly (with unit if relevant).\n"
            f"Task: {original_prompt}\nYour previous output (for reference):\n{model_answer}"
        )
    if kind == "code":
        return (
            "Return the corrected code in ONE fenced code block. It must parse.\n"
            f"Validation failure: {failure}\nTask: {original_prompt}\nYour previous output (for reference):\n{model_answer}"
        )
    return original_prompt


class AugmenterStats:
    """Rolling, measured counters (per process) for the status endpoint."""

    def __init__(self, window: int = 20):
        self._lock = threading.Lock()
        self._recent: Deque[Tuple[float, bool]] = deque(maxlen=window)
        self.counters: Dict[str, Any] = {
            "calls": 0,
            "ok": 0,
            "validation_failed": 0,
            "repairs_attempted": 0,
            "repairs_succeeded": 0,
            "oracle_failures": 0,
            "disabled_rejections": 0,
            "validation_failures_by_kind": {},
        }
        self.last_error_type: Optional[str] = None
        self.last_call_at: Optional[float] = None
        self.since = time.time()

    def record_disabled(self) -> None:
        with self._lock:
            self.counters["disabled_rejections"] += 1

    def record(self, *, kind: str, oracle_ok: bool, final_ok: bool, initial_ok: bool,
               repaired: bool, repair_ok: bool, error_type: Optional[str] = None) -> None:
        with self._lock:
            c = self.counters
            c["calls"] += 1
            self.last_call_at = time.time()
            self._recent.append((self.last_call_at, bool(oracle_ok)))
            if not oracle_ok:
                c["oracle_failures"] += 1
                self.last_error_type = error_type or "oracle_call_failed"
                return
            if final_ok:
                c["ok"] += 1
            else:
                c["validation_failed"] += 1
            if not initial_ok:
                by_kind = c["validation_failures_by_kind"]
                by_kind[kind] = int(by_kind.get(kind, 0)) + 1
            if repaired:
                c["repairs_attempted"] += 1
                if repair_ok:
                    c["repairs_succeeded"] += 1
            if error_type:
                self.last_error_type = error_type

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            recent = list(self._recent)
            counters = json.loads(json.dumps(self.counters))
        failures = sum(1 for _, ok in recent if not ok)
        rate = round(failures / len(recent), 3) if recent else None
        return {
            **counters,
            "recent_window": len(recent),
            "recent_oracle_failure_rate": rate,
            "last_error_type": self.last_error_type,
            "last_call_at": self.last_call_at,
            "counters_since": self.since,
            "counters_scope": "since_boot_this_worker",
        }


STATS = AugmenterStats()
