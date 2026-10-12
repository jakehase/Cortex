"""L19 Geneticist: deterministic fitness checks for candidate code.

Every number here is measured from the candidate text itself:

* ``compiles``          — ``compile(..., "exec")`` succeeds;
* ``lint``              — pyflakes messages when pyflakes is installed, otherwise
                          an AST check for unused imports and names that are
                          read but never bound anywhere in the module;
* ``complexity``        — branch-point count (if/for/while/try/with/bool ops/
                          comprehension ifs/except handlers) per module;
* ``diff_lines``        — added + removed lines versus the original;
* ``new_risks``         — L4 static AST risk findings present in the candidate
                          but not in the original (e.g. a new ``subprocess`` call);
* ``tests``             — the caller's test snippet is checked statically (it must
                          compile together with the candidate and call at least one
                          function the candidate defines).  It is *executed* only
                          by the caller through the Lab sandbox with an approval
                          capability; otherwise ``status: not_run``.

The score rule is declared in :data:`SCORE_RULE` and applied verbatim.
"""

from __future__ import annotations

import ast
import builtins
import difflib
from typing import Any, Dict, List, Optional, Set

from cortex_server.modules.lab_analysis import static_analysis

SCORE_RULE = (
    "viable = compiles AND changed AND no undefined names AND no new high-severity risk findings "
    "AND (tests not run OR all tests passed); "
    "score = 100*compiles + 40*test_pass_rate(if run) - 5*lint_issues - 10*new_high_risks "
    "- 2*max(0, complexity_delta) - min(20, 0.05*diff_lines); "
    "selected = highest score among viable candidates, ties broken by fewer diff_lines"
)

_BUILTINS = set(dir(builtins)) | {"__name__", "__file__", "__doc__", "__builtins__", "__spec__", "__package__"}


def compiles(code: str) -> Dict[str, Any]:
    try:
        compile(code, "<candidate>", "exec", dont_inherit=True)
        return {"ok": True}
    except SyntaxError as exc:
        return {"ok": False, "line": exc.lineno, "col": exc.offset, "message": str(exc.msg)[:200]}
    except (ValueError, RecursionError, MemoryError) as exc:
        return {"ok": False, "line": None, "col": None, "message": type(exc).__name__}


def _ast_lint(tree: ast.AST) -> List[Dict[str, Any]]:
    bound: Set[str] = set()
    loaded: Dict[str, int] = {}
    imported: Dict[str, int] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
            args = getattr(node, "args", None)
            if args is not None:
                for arg in args.posonlyargs + args.args + args.kwonlyargs:
                    bound.add(arg.arg)
                if args.vararg:
                    bound.add(args.vararg.arg)
                if args.kwarg:
                    bound.add(args.kwarg.arg)
        elif isinstance(node, ast.Lambda):
            for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                bound.add(arg.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                name = alias.asname or alias.name.split(".")[0]
                if name != "*":
                    bound.add(name)
                    imported.setdefault(name, node.lineno)
        elif isinstance(node, ast.Name):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                bound.add(node.id)
            else:
                loaded.setdefault(node.id, node.lineno)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            bound.update(node.names)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, ast.MatchAs) and node.name:
            bound.add(node.name)
    used_attr_roots = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    issues: List[Dict[str, Any]] = []
    for name, line in sorted(loaded.items(), key=lambda kv: kv[1]):
        if name not in bound and name not in _BUILTINS:
            issues.append({"line": line, "message": f"undefined name '{name}'"})
    for name, line in sorted(imported.items(), key=lambda kv: kv[1]):
        if name not in loaded and name not in used_attr_roots - set(imported):
            issues.append({"line": line, "message": f"'{name}' imported but unused"})
    return issues


def lint(code: str) -> Dict[str, Any]:
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return {"tool": "none", "issues": [], "count": 0, "skipped": "does_not_parse"}
    try:  # optional dependency
        from pyflakes import api as pyflakes_api  # type: ignore
        from pyflakes import reporter as pyflakes_reporter  # type: ignore
        import io

        out, err = io.StringIO(), io.StringIO()
        pyflakes_api.check(code, "candidate.py", pyflakes_reporter.Reporter(out, err))
        issues = []
        for row in out.getvalue().splitlines()[:50]:
            parts = row.split(":", 3)
            line = int(parts[1]) if len(parts) > 2 and parts[1].isdigit() else None
            issues.append({"line": line, "message": parts[-1].strip()[:200]})
        return {"tool": "pyflakes", "issues": issues, "count": len(issues)}
    except ImportError:
        issues = _ast_lint(tree)[:50]
        return {"tool": "ast_basic", "issues": issues, "count": len(issues)}


def complexity(code: str) -> Optional[int]:
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return None
    branches = 0
    for node in ast.walk(tree):
        if isinstance(node, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith,
                             ast.ExceptHandler, ast.IfExp, ast.Assert)):
            branches += 1
        elif isinstance(node, ast.BoolOp):
            branches += len(node.values) - 1
        elif isinstance(node, ast.comprehension):
            branches += 1 + len(node.ifs)
    return branches


def diff_stats(original: str, candidate: str) -> Dict[str, int]:
    added = removed = 0
    for line in difflib.unified_diff(original.splitlines(), candidate.splitlines(), lineterm="", n=0):
        if line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            added += 1
        elif line.startswith("-"):
            removed += 1
    return {"added": added, "removed": removed, "diff_lines": added + removed}


def _defined_functions(code: str) -> Set[str]:
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return set()
    return {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}


def static_test_check(candidate: str, tests: Optional[str]) -> Dict[str, Any]:
    if not tests or not tests.strip():
        return {"provided": False, "status": "none_provided"}
    combined = f"{candidate}\n\n{tests}"
    compiled = compiles(combined)
    try:
        test_tree = ast.parse(tests)
        called = {n.func.id for n in ast.walk(test_tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        called = set()
    defined = _defined_functions(candidate)
    exercised = sorted(called & defined)
    return {
        "provided": True,
        "status": "not_run",
        "reason": "test execution requires the Lab sandbox and an approval capability",
        "compiles_with_candidate": compiled["ok"],
        "exercises": exercised,
        "missing_targets": sorted(called - defined - set(dir(builtins)))[:20],
    }


def evaluate(original: str, candidate: str, *, tests: Optional[str] = None,
             test_run: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Fitness for one candidate. ``test_run`` is a sandbox result when tests were executed."""

    comp = compiles(candidate)
    lint_result = lint(candidate) if comp["ok"] else {"tool": "none", "issues": [], "count": 0, "skipped": "does_not_compile"}
    before_cx, after_cx = complexity(original), complexity(candidate)
    cx_delta = (after_cx - before_cx) if (before_cx is not None and after_cx is not None) else None
    diff = diff_stats(original, candidate)
    orig_risks = static_analysis(original) if original.strip() else {"findings": []}
    cand_risks = static_analysis(candidate)

    def _keys(report: Dict[str, Any]) -> Set[tuple]:
        return {(f["rule"], f.get("detail")) for f in report.get("findings") or [] if f.get("severity") == "high"}

    new_high = sorted(_keys(cand_risks) - _keys(orig_risks))
    tests_info = static_test_check(candidate, tests)
    pass_rate: Optional[float] = None
    if test_run is not None:
        passed = bool(test_run.get("success")) and int(test_run.get("exit_code", 1)) == 0 and not test_run.get("timed_out")
        tests_info = {**tests_info, "status": "passed" if passed else "failed",
                      "exit_code": test_run.get("exit_code"), "timed_out": bool(test_run.get("timed_out")),
                      "stderr_tail": str(test_run.get("stderr") or "")[-600:],
                      "receipt_sha256": test_run.get("receipt_sha256"), "execution_plane": test_run.get("execution_plane")}
        pass_rate = 1.0 if passed else 0.0
    tests_ok = pass_rate is None or pass_rate == 1.0
    undefined = [i for i in lint_result.get("issues") or [] if "undefined name" in str(i.get("message", ""))]
    viable = bool(comp["ok"] and not new_high and tests_ok and diff["diff_lines"] > 0 and not undefined)
    score = (
        100.0 * (1 if comp["ok"] else 0)
        + (40.0 * pass_rate if pass_rate is not None else 0.0)
        - 5.0 * lint_result.get("count", 0)
        - 10.0 * len(new_high)
        - 2.0 * max(0, cx_delta or 0)
        - min(20.0, 0.05 * diff["diff_lines"])
    )
    reasons = []
    if not comp["ok"]:
        reasons.append("does_not_compile")
    if new_high:
        reasons.append("introduces_high_severity_risk")
    if not tests_ok:
        reasons.append("tests_failed")
    if diff["diff_lines"] == 0:
        reasons.append("no_change")
    if undefined:
        reasons.append("undefined_names")
    return {
        "compiles": comp["ok"],
        "compile_error": None if comp["ok"] else comp,
        "lint": lint_result,
        "complexity_before": before_cx,
        "complexity_after": after_cx,
        "complexity_delta": cx_delta,
        "diff": diff,
        "new_high_risks": [{"rule": r, "detail": d} for r, d in new_high],
        "tests": tests_info,
        "viable": viable,
        "not_viable_reasons": reasons,
        "score": round(score, 2),
    }


def select(candidates: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    viable = [c for c in candidates if (c.get("fitness") or {}).get("viable")]
    if not viable:
        return None
    return sorted(viable, key=lambda c: (-c["fitness"]["score"], c["fitness"]["diff"]["diff_lines"]))[0]
