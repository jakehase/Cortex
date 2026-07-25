from __future__ import annotations

from typing import Any, Dict

from .confabulation_detector import detect_confabulation

JsonDict = Dict[str, Any]


def guard_output(*, claims: list[JsonDict], fallback_text: str = 'I need to qualify that claim before sending it.') -> JsonDict:
    result = detect_confabulation(claims)
    if not result.get('flagged'):
        return {'action': 'allow', 'issues': []}
    blocking_reasons = {
        'contradiction',
        'invalid_claim_metadata',
        'invalid_contradiction_metadata',
        'invalid_evidence_metadata',
    }
    if any(issue.get('reason') in blocking_reasons for issue in result.get('issues') or []):
        return {'action': 'block', 'issues': result.get('issues') or [], 'fallback_text': fallback_text}
    return {'action': 'clarify', 'issues': result.get('issues') or [], 'fallback_text': fallback_text}
