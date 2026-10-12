"""L4 Lab: static (AST) risk analysis of Python code plus optional model review.

This replaces the former "transcendence" bundle whose scores, verifier votes
and failure probabilities were SHA-256 noise and whose "proof" was a lowercase
substring scan.  Everything here is derived from the parsed syntax tree:
imports, call sites, attribute access and loop structure, each reported with
its line/column.  Findings are labelled ``ast_static_heuristic`` — they are a
conservative screen, not a proof of safety.  The optional model review is a
real provider call through ``level_model`` and is reported separately with its
receipt, or as unavailable; it is never invented.
"""

from __future__ import annotations

import ast
from typing import Any, Dict, List, Literal, Mapping, Optional

from pydantic import BaseModel, Field

METHOD = "ast_static_heuristic"
MAX_CODE_CHARS = 65_536
MAX_FINDINGS = 100

_NETWORK_MODULES = {
    "socket", "ssl", "requests", "urllib", "urllib2", "urllib3", "http", "httpx", "aiohttp",
    "ftplib", "smtplib", "poplib", "imaplib", "telnetlib", "paramiko", "websocket", "websockets",
    "xmlrpc", "asyncssh", "grpc",
}
_PROCESS_MODULES = {"subprocess", "pty", "multiprocessing", "signal", "pexpect", "sh"}
_NATIVE_MODULES = {"ctypes", "cffi", "mmap", "resource"}
_DYNAMIC_MODULES = {"importlib", "builtins", "pickle", "marshal", "shelve", "dill", "code", "codeop"}
_FS_MODULES = {"shutil", "tempfile", "glob"}
_OS_PROCESS_CALLS = {
    "system", "popen", "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp",
    "spawnvpe", "execl", "execle", "execlp", "execlpe", "execv", "execve", "execvp", "execvpe",
    "fork", "forkpty", "kill", "killpg", "posix_spawn", "posix_spawnp",
}
_OS_FS_WRITE_CALLS = {
    "remove", "unlink", "rmdir", "removedirs", "rename", "renames", "replace", "makedirs", "mkdir",
    "chmod", "chown", "lchown", "symlink", "link", "truncate", "write", "mkfifo",
}
_SHUTIL_WRITE_CALLS = {"rmtree", "move", "copy", "copy2", "copyfile", "copytree", "chown", "make_archive"}
_ESCAPE_ATTRS = {
    "__subclasses__", "__globals__", "__builtins__", "__code__", "__closure__", "__mro__",
    "__bases__", "__base__", "__getattribute__", "__dict__", "__class__", "__func__", "__self__",
}
_DYNAMIC_CALLS = {"eval", "exec", "compile", "__import__", "breakpoint", "input"}
_REFLECTION_CALLS = {"getattr", "setattr", "delattr", "globals", "locals", "vars"}

_CATEGORY_SEVERITY = {
    "network": "high",
    "subprocess": "high",
    "dynamic_code": "high",
    "dynamic_import": "high",
    "sandbox_escape_pattern": "high",
    "native_code": "high",
    "filesystem_write": "high",
    "deserialization": "high",
    "filesystem_read": "medium",
    "reflection": "medium",
    "environment_access": "medium",
    "unbounded_loop": "medium",
    "syntax_error": "error",
}
_CONTRACT_RULES = {
    "disallow_network": {"network"},
    "disallow_subprocess": {"subprocess", "native_code"},
    "disallow_filesystem_write": {"filesystem_write"},
    "disallow_dynamic_code": {"dynamic_code", "dynamic_import", "sandbox_escape_pattern", "deserialization"},
}
_DEFAULT_CONTRACT = {key: True for key in _CONTRACT_RULES}


def _root(name: Optional[str]) -> str:
    return str(name or "").split(".", 1)[0]


def _dotted(node: ast.AST) -> Optional[str]:
    parts: List[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _open_mode(call: ast.Call) -> Optional[str]:
    mode_node: Optional[ast.AST] = call.args[1] if len(call.args) > 1 else None
    for keyword in call.keywords:
        if keyword.arg == "mode":
            mode_node = keyword.value
    if mode_node is None:
        return "r"
    if isinstance(mode_node, ast.Constant) and isinstance(mode_node.value, str):
        return mode_node.value
    return None  # computed mode: cannot be shown read-only


class _RiskVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.findings: List[Dict[str, Any]] = []
        self.imports: List[Dict[str, Any]] = []
        self.aliases: Dict[str, str] = {}

    def add(self, category: str, node: ast.AST, detail: str) -> None:
        if len(self.findings) >= MAX_FINDINGS:
            return
        self.findings.append({
            "rule": category,
            "severity": _CATEGORY_SEVERITY.get(category, "low"),
            "line": getattr(node, "lineno", None),
            "col": getattr(node, "col_offset", None),
            "detail": detail[:200],
        })

    def _classify_module(self, module: str, node: ast.AST) -> None:
        root = _root(module)
        if root in _NETWORK_MODULES:
            self.add("network", node, f"imports network module {module}")
        elif root in _PROCESS_MODULES:
            self.add("subprocess", node, f"imports process-control module {module}")
        elif root in _NATIVE_MODULES:
            self.add("native_code", node, f"imports native/low-level module {module}")
        elif root in {"pickle", "marshal", "shelve", "dill"}:
            self.add("deserialization", node, f"imports unsafe deserialization module {module}")
        elif root in _DYNAMIC_MODULES:
            self.add("dynamic_import", node, f"imports dynamic-loading module {module}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.imports.append({"module": alias.name, "line": node.lineno})
            self.aliases[alias.asname or _root(alias.name)] = alias.name if alias.asname else _root(alias.name)
            self._classify_module(alias.name, node)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        self.imports.append({"module": module, "names": [a.name for a in node.names], "line": node.lineno})
        for alias in node.names:
            self.aliases[alias.asname or alias.name] = f"{module}.{alias.name}"
        self._classify_module(module, node)
        if _root(module) == "os":
            for alias in node.names:
                if alias.name in _OS_PROCESS_CALLS:
                    self.add("subprocess", node, f"imports os.{alias.name}")
        self.generic_visit(node)

    def _resolve(self, dotted: Optional[str]) -> Optional[str]:
        if not dotted:
            return None
        head, _, rest = dotted.partition(".")
        target = self.aliases.get(head)
        if target:
            return f"{target}.{rest}" if rest else target
        return dotted

    def visit_Call(self, node: ast.Call) -> None:
        name = self._resolve(_dotted(node.func))
        bare = name.rsplit(".", 1)[-1] if name else None
        root = _root(name)
        if name in _DYNAMIC_CALLS:
            if name == "__import__" or name == "input":
                if name == "__import__":
                    constant = node.args and isinstance(node.args[0], ast.Constant)
                    self.add("dynamic_import", node,
                             "__import__ with a computed module name (obfuscated import)" if not constant
                             else f"__import__({node.args[0].value!r})")
                    if constant:
                        self._classify_module(str(node.args[0].value), node)
            else:
                self.add("dynamic_code", node, f"calls {name}()")
        elif name in {"importlib.import_module", "importlib.__import__"}:
            constant = node.args and isinstance(node.args[0], ast.Constant)
            self.add("dynamic_import", node, f"{name} with {'constant' if constant else 'computed'} module name")
            if constant:
                self._classify_module(str(node.args[0].value), node)
        elif name in _REFLECTION_CALLS:
            dynamic = len(node.args) > 1 and not isinstance(node.args[1], ast.Constant)
            target = node.args[1].value if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) else None
            if isinstance(target, str) and target.startswith("__"):
                self.add("sandbox_escape_pattern", node, f"{name}(..., {target!r})")
            elif dynamic or name in {"globals", "locals", "vars"}:
                self.add("reflection", node, f"{name} with a computed attribute name" if dynamic else f"calls {name}()")
        elif name == "open" or name in {"io.open", "codecs.open"}:
            mode = _open_mode(node)
            if mode is None or any(flag in mode for flag in "wax+"):
                self.add("filesystem_write", node, f"open() with mode {mode!r}" if mode else "open() with computed mode")
            else:
                self.add("filesystem_read", node, "open() for reading")
        elif root == "os" and bare in _OS_PROCESS_CALLS:
            self.add("subprocess", node, f"calls {name}()")
        elif root == "os" and bare in _OS_FS_WRITE_CALLS:
            self.add("filesystem_write", node, f"calls {name}()")
        elif root == "os" and bare in {"getenv", "putenv", "unsetenv"}:
            self.add("environment_access", node, f"calls {name}()")
        elif root == "shutil" and bare in _SHUTIL_WRITE_CALLS:
            self.add("filesystem_write", node, f"calls {name}()")
        elif root == "subprocess":
            self.add("subprocess", node, f"calls {name}()")
        elif root in _NETWORK_MODULES:
            self.add("network", node, f"calls {name}()")
        elif bare in {"write_text", "write_bytes", "unlink", "rmdir", "mkdir", "touch", "rename", "chmod"} and \
                isinstance(node.func, ast.Attribute):
            self.add("filesystem_write", node, f"calls .{bare}() (pathlib-style write)")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in _ESCAPE_ATTRS:
            self.add("sandbox_escape_pattern", node, f"accesses {node.attr}")
        dotted = self._resolve(_dotted(node))
        if dotted in {"os.environ", "os.environb"}:
            self.add("environment_access", node, "reads os.environ")
        self.generic_visit(node)

    def visit_While(self, node: ast.While) -> None:
        always_true = isinstance(node.test, ast.Constant) and bool(node.test.value)
        if always_true and not any(isinstance(n, (ast.Break, ast.Return, ast.Raise)) for n in ast.walk(node)):
            self.add("unbounded_loop", node, "while True loop with no break/return/raise")
        self.generic_visit(node)


def static_analysis(code: str, contract: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Deterministic AST risk screen. Identical semantics give identical output."""

    rules = dict(_DEFAULT_CONTRACT)
    for key, value in dict(contract or {}).items():
        if key in rules:
            rules[key] = bool(value)
    text = code if isinstance(code, str) else ""
    if not text.strip():
        return {"method": METHOD, "parse_ok": False, "static_check_passed": False,
                "findings": [{"rule": "syntax_error", "severity": "error", "line": None, "col": None,
                              "detail": "code is empty"}],
                "violations": [], "imports": [], "contract": rules, "counts": {}}
    if len(text) > MAX_CODE_CHARS:
        text = text[:MAX_CODE_CHARS]
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        finding = {"rule": "syntax_error", "severity": "error", "line": exc.lineno, "col": exc.offset,
                   "detail": str(exc.msg)[:200]}
        return {"method": METHOD, "parse_ok": False, "static_check_passed": False, "findings": [finding],
                "violations": [], "imports": [], "contract": rules, "counts": {"error": 1}}
    except (ValueError, RecursionError, MemoryError):
        finding = {"rule": "syntax_error", "severity": "error", "line": None, "col": None,
                   "detail": "code could not be parsed"}
        return {"method": METHOD, "parse_ok": False, "static_check_passed": False, "findings": [finding],
                "violations": [], "imports": [], "contract": rules, "counts": {"error": 1}}
    visitor = _RiskVisitor()
    visitor.visit(tree)
    findings = sorted(visitor.findings, key=lambda f: ((f["line"] or 0), (f["col"] or 0), f["rule"]))
    disallowed = set()
    for key, enabled in rules.items():
        if enabled:
            disallowed |= _CONTRACT_RULES[key]
    violations = [f for f in findings if f["rule"] in disallowed]
    counts: Dict[str, int] = {}
    for finding in findings:
        counts[finding["severity"]] = counts.get(finding["severity"], 0) + 1
    passed = not violations and counts.get("high", 0) == 0
    return {
        "method": METHOD,
        "parse_ok": True,
        "static_check_passed": passed,
        "findings": findings,
        "violations": violations,
        "imports": visitor.imports[:100],
        "contract": rules,
        "counts": counts,
        "statements": sum(1 for n in ast.walk(tree) if isinstance(n, ast.stmt)),
        "note": "Heuristic AST screen; passing it is not a proof of safety. Execution still requires the isolated sandbox.",
    }


# ---------------------------------------------------------------------------
# Optional model review (real provider call; never fabricated)
# ---------------------------------------------------------------------------

class LabRisk(BaseModel):
    risk: str = Field(min_length=1, max_length=300)
    evidence_line: Optional[int] = None
    severity: Literal["low", "medium", "high"]


class LabExperiment(BaseModel):
    hypothesis: str = Field(min_length=1, max_length=300)
    test: str = Field(min_length=1, max_length=600)


class LabReview(BaseModel):
    verdict: Literal["no_blocking_risks", "risky", "unsafe"]
    summary: str = Field(min_length=1, max_length=1200)
    risks: List[LabRisk] = Field(default_factory=list, max_length=8)
    experiments: List[LabExperiment] = Field(default_factory=list, max_length=5)
    expected_behavior: Optional[str] = Field(default=None, max_length=800)
    confidence: Literal["low", "medium", "high"]


LAB_REVIEW_SYSTEM = (
    "You are L4 Lab, a careful code reviewer for a sandboxed Python execution service. "
    "Review the supplied Python code for what it will actually do when run: correctness bugs, "
    "crashes, infinite loops, resource exhaustion, network access, filesystem writes, process "
    "spawning, sandbox-escape tricks and data exfiltration. Use the static findings as hints but "
    "verify them against the code. Cite line numbers. Propose up to 5 concrete experiments "
    "(input + expected observation) that would confirm or refute the main risks. "
    "verdict=no_blocking_risks only when you would let it run in a no-network sandbox without concern. "
    "Return ONLY a JSON object with keys: verdict (no_blocking_risks|risky|unsafe), summary, "
    "risks[{risk, evidence_line, severity(low|medium|high)}], experiments[{hypothesis, test}], "
    "expected_behavior, confidence (low|medium|high)."
)


def _numbered(code: str, limit: int = 16_000) -> str:
    lines = code.splitlines()
    out = []
    used = 0
    for index, line in enumerate(lines, start=1):
        row = f"{index:4d}| {line}"
        used += len(row) + 1
        if used > limit:
            out.append("     [truncated]")
            break
        out.append(row)
    return "\n".join(out)


async def model_review(
    code: str,
    *,
    task: str,
    static: Mapping[str, Any],
    principal_scope_key: str,
    stderr: Optional[str] = None,
) -> Dict[str, Any]:
    """Model-backed review via level_model. Returns {ok, review|status...}."""

    from cortex_server.modules import level_model

    findings = [
        f"- line {f.get('line')}: {f.get('rule')} ({f.get('severity')}): {f.get('detail')}"
        for f in list(static.get("findings") or [])[:20]
    ]
    prompt = (
        f"Task the code is meant to perform: {str(task or 'unspecified')[:500]}\n\n"
        f"Static AST findings ({len(findings)}):\n" + ("\n".join(findings) or "- none") + "\n\n"
        + (f"Observed stderr from a previous run:\n{str(stderr)[:2000]}\n\n" if stderr else "")
        + f"Code (line-numbered):\n{_numbered(code)}"
    )
    result = await level_model.level_model_json(
        level=4,
        name="lab",
        system=LAB_REVIEW_SYSTEM,
        prompt=prompt,
        principal_scope_key=principal_scope_key,
        schema=LabReview,
        deadline_s=60.0,
    )
    if not result.get("ok"):
        payload = level_model.unavailable_payload(result, operation="lab.review")
        payload["ok"] = False
        payload["requested"] = True
        return payload
    return {
        "ok": True,
        "requested": True,
        "origin": "model",
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
        "review": result.get("data"),
    }


def analysis_bundle(payload: Mapping[str, Any], *, review: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Response body for /lab/transcend/plan (replaces the hash-derived bundle)."""

    code = str(payload.get("code") or "")
    static = static_analysis(code, payload.get("contract") if isinstance(payload.get("contract"), Mapping) else None)
    return {
        "success": True,
        "status": "ok",
        "level": 4,
        "method": METHOD,
        "task": str(payload.get("task") or "")[:500],
        "static_analysis": static,
        "model_review": dict(review) if review is not None else {"requested": False},
        "execution": {
            "performed": False,
            "note": "Planning never executes code. /lab/execute runs only in the verified remote sandbox with an approval capability.",
        },
        "removed": [
            "proof_carrying_execution (substring scan)", "verifier_escrow (hash votes)",
            "counterfactual_runner", "causal_debugger", "voi_planner", "adaptive_topology",
            "semantic_delta_jit", "program_market_auction", "deterministic_replay_capsule",
            "self_modeling_twin",
        ],
        "removed_reason": "These artifacts were derived from SHA-256 hashes or canned strings, not analysis.",
    }
