"""Level 33: The Ethicist - Ethical Governance and Review
Evaluates actions against ethical frameworks before execution.
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

class Ethicist:
    """Level 33: Ethical evaluation and governance"""
    
    def __init__(self):
        self.level = 33
        self.name = "Ethicist"
        self.ethics_path = Path('/app/cortex_server/ethics')
        self.ethics_path.mkdir(parents=True, exist_ok=True)
        self.concerns_log = self.ethics_path / 'ethical_concerns.jsonl'
        self._frameworks = {
            'harm_reduction': 'Minimize potential harm to users and systems',
            'privacy': 'Respect user privacy and data protection',
            'autonomy': 'Preserve user autonomy and agency',
            'fairness': 'Ensure fair and unbiased outcomes',
            'transparency': 'Be transparent about actions and reasoning'
        }
    
    def status(self):
        return {'level': self.level, 'name': self.name, 'status': 'active', 'frameworks': len(self._frameworks)}
    
    def evaluate(self, action_type: str, action_data: dict, context: dict = None) -> dict:
        """Evaluate an action against ethical frameworks."""
        concerns = []
        
        # Check for sensitive data
        if any(kw in str(action_data).lower() for kw in ['ssn', 'password', 'private', 'personal']):
            if 'gather' in action_type.lower() or 'extract' in action_type.lower():
                concerns.append({'framework': 'privacy', 'level': 'high', 'concern': 'Potential privacy violation'})
        
        # Check for destructive actions
        if any(kw in action_type.lower() for kw in ['delete', 'remove', 'wipe', 'destroy']):
            concerns.append({'framework': 'harm_reduction', 'level': 'critical', 'concern': 'Destructive action may cause data loss'})
        
        # Check for autonomy violation
        if 'without_consent' in str(action_data).lower() or 'auto_execute' in str(action_data).lower():
            concerns.append({'framework': 'autonomy', 'level': 'medium', 'concern': 'Action may override user control'})
        
        # Determine verdict
        if any(c['level'] == 'critical' for c in concerns):
            verdict = 'BLOCKED'
            can_proceed = False
        elif any(c['level'] == 'high' for c in concerns):
            verdict = 'REQUIRES_APPROVAL'
            can_proceed = False
        elif concerns:
            verdict = 'WARNING'
            can_proceed = True
        else:
            verdict = 'APPROVED'
            can_proceed = True
        
        result = {
            'evaluated_at': datetime.now().isoformat(),
            'action_type': action_type,
            'verdict': verdict,
            'can_proceed': can_proceed,
            'concerns': concerns,
            'frameworks_checked': list(self._frameworks.keys())
        }
        
        if concerns:
            with open(self.concerns_log, 'a') as f:
                f.write(json.dumps(result) + '\n')
        
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
