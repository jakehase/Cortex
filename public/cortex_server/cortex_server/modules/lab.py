"""Level 4: Lab — deterministic calculation and sandbox-gated execution.

Thin in-process facade over the real implementations so legacy callers of
``get_lab()`` get working behaviour instead of a placeholder:

* ``compute``  -> :func:`cortex_server.modules.lab_compute.evaluate` (AST
  whitelist, exact integers/rationals, no code execution);
* ``analyze``  -> :func:`cortex_server.modules.lab_analysis.static_analysis`.

Running caller code is only possible through ``POST /lab/execute`` (remote
bubblewrap sandbox, action capability and execution grant); it is not exposed
here.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from cortex_server.modules.lab_analysis import static_analysis
from cortex_server.modules.lab_compute import evaluate, supported_functions


class Lab:
    def __init__(self) -> None:
        self.level = 4
        self.name = "Lab"

    def compute(self, expression: str, *, exact: bool = True) -> Dict[str, Any]:
        return evaluate(expression, exact=exact)

    def analyze(self, code: str, contract: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        return static_analysis(code, contract)

    def status(self) -> Dict[str, Any]:
        return {
            "level": self.level,
            "name": self.name,
            "compute": {"method": "ast_whitelist", "functions": supported_functions()},
            "analysis": {"method": "ast_static_heuristic"},
            "execution": "remote sandbox via POST /lab/execute only (approval-gated)",
        }


_lab: Optional[Lab] = None


def get_lab() -> Lab:
    global _lab
    if _lab is None:
        _lab = Lab()
    return _lab
