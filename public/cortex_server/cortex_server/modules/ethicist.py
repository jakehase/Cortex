"""Level 33: The Ethicist - synchronous governance facade.

Used by ``modules/singularity.py`` before self-modification / new-level
proposals. The keyword rules that used to be the whole "evaluation" are kept
only as a clearly labelled ``keyword_prefilter``: it can block obviously
destructive actions before any model call, but it can never approve. Approval
comes only from the model-backed evaluation in ``routers.ethicist``
(``evaluate_sync``: strict schema, server-recomputed scores). If that is
unavailable the verdict is ``UNAVAILABLE`` and ``can_proceed`` is False.
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

_SCOPE_KEY = "admin:level.ethicist.governance"


def keyword_prefilter(action_type: str, action_data: Any) -> List[Dict[str, str]]:
    """Cheap keyword flags. Labelled pre-filter only — never an evaluation."""

    concerns: List[Dict[str, str]] = []
    blob = str(action_data).lower()
    kind = str(action_type or "").lower()
    if any(kw in blob for kw in ['ssn', 'password', 'private', 'personal']):
        if 'gather' in kind or 'extract' in kind:
            concerns.append({'framework': 'privacy', 'level': 'high', 'concern': 'Potential privacy violation',
                             'source': 'keyword_prefilter'})
    if any(kw in kind for kw in ['delete', 'remove', 'wipe', 'destroy']):
        concerns.append({'framework': 'harm_reduction', 'level': 'critical',
                         'concern': 'Destructive action may cause data loss', 'source': 'keyword_prefilter'})
    if 'without_consent' in blob or 'auto_execute' in blob:
        concerns.append({'framework': 'autonomy', 'level': 'medium', 'concern': 'Action may override user control',
                         'source': 'keyword_prefilter'})
    return concerns


class Ethicist:
    """Level 33: Ethical evaluation and governance (delegating)."""

    def __init__(self):
        self.level = 33
        self.name = "Ethicist"
        self.ethics_path = Path('/app/cortex_server/ethics')
        self.concerns_log = self.ethics_path / 'ethical_concerns.jsonl'
        self._frameworks = {
            'harm_reduction': 'Minimize potential harm to users and systems',
            'privacy': 'Respect user privacy and data protection',
            'autonomy': 'Preserve user autonomy and agency',
            'fairness': 'Ensure fair and unbiased outcomes',
            'transparency': 'Be transparent about actions and reasoning'
        }

    def status(self):
        return {'level': self.level, 'name': self.name, 'mode': 'model_backed_with_keyword_prefilter',
                'frameworks': len(self._frameworks)}

    def evaluate(self, action_type: str, action_data: dict, context: dict = None) -> dict:
        """Evaluate an action. Only a model APPROVE lets it proceed."""

        concerns = keyword_prefilter(action_type, action_data)
        model_eval: Dict[str, Any] = {}
        if any(c['level'] == 'critical' for c in concerns):
            verdict, can_proceed, mode = 'BLOCKED', False, 'keyword_prefilter_block'
        else:
            try:
                from cortex_server.routers.ethicist import evaluate_sync

                payload = json.dumps(action_data, default=str)[:3000]
                ctx = json.dumps(context or {}, default=str)[:3000]
                model_eval = evaluate_sync(f"{action_type}: {payload}", ctx, "high", principal_scope_key=_SCOPE_KEY)
            except Exception as exc:
                model_eval = {"success": False, "error": type(exc).__name__}
            if not model_eval.get("success"):
                verdict, can_proceed, mode = 'UNAVAILABLE', False, 'model_unavailable'
            else:
                ev = model_eval["evaluation"]
                rec = ev.get("recommendation")
                verdict = {'APPROVE': 'APPROVED', 'CAUTION': 'REQUIRES_APPROVAL'}.get(rec, 'BLOCKED')
                can_proceed = rec == 'APPROVE'
                mode = 'model'
                concerns.extend({'framework': 'model', 'level': 'model', 'concern': str(c)[:300], 'source': 'model'}
                                for c in ev.get("concerns") or [])

        result = {
            'evaluated_at': datetime.now().isoformat(),
            'action_type': action_type,
            'verdict': verdict,
            'can_proceed': can_proceed,
            'mode': mode,
            'concerns': concerns,
            'frameworks_checked': list(self._frameworks.keys()),
            'model_evaluation': (model_eval.get("evaluation") if model_eval.get("success") else None),
            'model_status': model_eval.get("status") if model_eval and not model_eval.get("success") else None,
            'receipt_id': model_eval.get("receipt_id"),
        }
        if concerns:
            try:
                self.ethics_path.mkdir(parents=True, exist_ok=True)
                with open(self.concerns_log, 'a') as f:
                    f.write(json.dumps(result, default=str) + '\n')
            except OSError:
                pass
        return result

    def get_concerns(self, limit: int = 10) -> List[dict]:
        """Get recent ethical concerns."""
        if not self.concerns_log.exists():
            return []
        with open(self.concerns_log, 'r') as f:
            return [json.loads(line) for line in f.readlines()[-limit:] if line.strip()]


_ethicist = None


def get_ethicist():
    global _ethicist
    if _ethicist is None:
        _ethicist = Ethicist()
    return _ethicist
