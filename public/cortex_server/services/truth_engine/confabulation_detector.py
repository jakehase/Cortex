from __future__ import annotations

from typing import Any, Dict, Iterable, List

JsonDict = Dict[str, Any]


def detect_confabulation(claims: Iterable[JsonDict]) -> JsonDict:
    issues: List[JsonDict] = []
    for row in claims:
        claim = dict(row)
        claim_id = str(claim.get('claim_id') or 'unknown')
        evidence = list(claim.get('evidence') or [])
        contradiction_count = int(claim.get('contradiction_count', 0) or 0)
        if not evidence:
            issues.append({'claim_id': claim_id, 'reason': 'missing_evidence'})
        if contradiction_count > 0:
            issues.append({'claim_id': claim_id, 'reason': 'contradiction'})
    return {'flagged': bool(issues), 'issues': issues}
