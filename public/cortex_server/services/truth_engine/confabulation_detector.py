from __future__ import annotations

import math
from numbers import Integral, Real
from collections.abc import Iterable, Mapping
from typing import Any, Dict, List

JsonDict = Dict[str, Any]
_MAX_CONTRADICTION_COUNT = (1 << 63) - 1


def _contradiction_count(value: Any) -> tuple[int, bool]:
    """Return a safe count and whether the supplied metadata was valid."""
    if value is None:
        return 0, True
    if isinstance(value, bool) or not isinstance(value, Real):
        return 0, False
    # Preserve arbitrary-precision integers instead of converting them through
    # float, which can raise OverflowError for untrusted, very large metadata.
    if isinstance(value, Integral):
        if value < 0 or value > _MAX_CONTRADICTION_COUNT:
            return 0, False
        return int(value), True
    try:
        numeric = float(value)
    except (OverflowError, TypeError, ValueError):
        return 0, False
    if not math.isfinite(numeric) or numeric < 0 or not numeric.is_integer():
        return 0, False
    return int(numeric), True


def detect_confabulation(claims: Iterable[JsonDict]) -> JsonDict:
    issues: List[JsonDict] = []
    if isinstance(claims, (str, bytes, Mapping)) or not isinstance(claims, Iterable):
        return {'flagged': True, 'issues': [{'claim_id': 'unknown', 'reason': 'invalid_claim_metadata'}]}
    for row in claims:
        if not isinstance(row, Mapping):
            issues.append({'claim_id': 'unknown', 'reason': 'invalid_claim_metadata'})
            continue
        claim = dict(row)
        claim_id = str(claim.get('claim_id') or 'unknown')
        evidence_value = claim.get('evidence')
        evidence_valid = evidence_value is None or (
            isinstance(evidence_value, Iterable)
            and not isinstance(evidence_value, (str, bytes, Mapping))
        )
        evidence = list(evidence_value or []) if evidence_valid else []
        if not evidence_valid:
            issues.append({'claim_id': claim_id, 'reason': 'invalid_evidence_metadata'})
        contradiction_count, valid_count = _contradiction_count(claim.get('contradiction_count', 0))
        if not evidence:
            issues.append({'claim_id': claim_id, 'reason': 'missing_evidence'})
        if not valid_count:
            issues.append({'claim_id': claim_id, 'reason': 'invalid_contradiction_metadata'})
        if contradiction_count > 0:
            issues.append({'claim_id': claim_id, 'reason': 'contradiction'})
    return {'flagged': bool(issues), 'issues': issues}
