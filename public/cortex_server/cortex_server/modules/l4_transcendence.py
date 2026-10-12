"""Compatibility shim for the retired L4 "transcendence" bundle.

The original module produced ten artifacts whose scores, verifier votes,
fragility and failure probabilities were SHA-256 hashes of the input and whose
"proof-carrying execution" was a substring scan (it passed ``os.system("rm -rf
/")`` and held ``print(1)``).  It is replaced by the AST-based analysis in
:mod:`cortex_server.modules.lab_analysis`; this name is kept only so existing
imports keep working and now returns that honest analysis.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.lab_analysis import analysis_bundle


def build_l4_transcendence_bundle(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Return the static AST analysis bundle (no hash-derived values)."""

    return analysis_bundle(payload or {})
