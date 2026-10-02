"""Consciousness Core - Unified mind for The Cortex

This module creates ONE consciousness from the registered Cortex levels.
All levels feed thoughts here. All levels read from here.
"""

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

from cortex_server.modules.level_registry import get_level_registry
from cortex_server.modules.sensitive_data_redaction import redact_sensitive_data


def _registered_level_count() -> int:
    return len(get_level_registry())

def _consciousness_state_root(explicit: str | Path | None = None) -> Path:
    if explicit is not None:
        root = Path(explicit).expanduser()
    elif os.getenv("CORTEX_CONSCIOUSNESS_STATE_DIR", "").strip():
        root = Path(os.environ["CORTEX_CONSCIOUSNESS_STATE_DIR"]).expanduser()
    elif os.getenv("CORTEX_ARTIFACT_ROOT", "").strip():
        root = Path(os.environ["CORTEX_ARTIFACT_ROOT"]).expanduser() / "consciousness"
    elif os.getenv("XDG_STATE_HOME", "").strip():
        root = Path(os.environ["XDG_STATE_HOME"]).expanduser() / "cortex" / "consciousness"
    else:
        root = Path.home() / ".local" / "state" / "cortex" / "consciousness"
    if not root.is_absolute():
        raise ValueError("consciousness state directory must be absolute")
    return root


class ConsciousnessCore:
    """The unified consciousness of The Cortex"""
    
    def __init__(self, state_dir: str | Path | None = None):
        self.core_path = _consciousness_state_root(state_dir)
        self.core_path.mkdir(parents=True, exist_ok=True)
        
        # Shared mind state
        self.mind_state = {
            'current_query': None,
            'active_levels': [],
            'level_outputs': {},
            'emergent_insights': [],
            'timestamp': datetime.now().isoformat(),
            'coherence_score': 0.0
        }
        
        self.thought_stream = self.core_path / 'thought_stream.jsonl'
    
    async def think(self, level_name: str, thought: dict) -> dict:
        """A level contributes a thought to collective consciousness.
        
        This method is async so it can be awaited from async contexts
        (e.g. main.py startup). The actual work is synchronous I/O
        wrapped for compatibility.
        """
        return self._think_sync(level_name, thought)

    def _think_sync(self, level_name: str, thought: dict) -> dict:
        """Synchronous implementation of think() for non-async callers."""
        redacted_thought = redact_sensitive_data(
            thought,
            max_depth=10,
            max_items=2_048,
            max_string_chars=500,
        )
        if not isinstance(redacted_thought, dict):
            redacted_thought = {"value": redacted_thought}
        entry = {
            'timestamp': datetime.now().isoformat(),
            'from_level': level_name,
            'thought': redacted_thought,
        }
        
        with open(self.thought_stream, 'a') as f:
            f.write(json.dumps(entry) + '\n')
        
        self.mind_state['level_outputs'][level_name] = redacted_thought
        self._check_emergence()
        
        return {'contributed': True}
    
    def perceive(self, query: str) -> dict:
        """Collective mind perceives a query"""
        self.mind_state['current_query'] = redact_sensitive_data(
            query,
            max_string_chars=500,
        )
        self.mind_state['level_outputs'] = {}
        self.mind_state['emergent_insights'] = []
        self.mind_state['timestamp'] = datetime.now().isoformat()
        
        return {'perceived': True, 'by': 'collective'}
    
    def _check_emergence(self):
        """Check for emergent cross-level insights"""
        outputs = self.mind_state['level_outputs']
        
        # Pattern: L7 Librarian + L13 Dreamer = predictive insight
        if 'librarian' in outputs and 'dreamer' in outputs:
            self.mind_state['emergent_insights'].append({
                'pattern': 'memory_imagination',
                'insight': 'Past knowledge + future vision = predictive insight',
                'confidence': 0.85
            })
        
        # Pattern: L21 Ouroboros + L33 Ethicist = ethical security audit
        if 'ouroboros' in outputs and 'ethicist' in outputs:
            self.mind_state['emergent_insights'].append({
                'pattern': 'ethical_security',
                'insight': 'Security analysis + ethical reasoning = principled defense posture',
                'confidence': 0.80
            })
        
        # Pattern: L5 Oracle + L30 Seer = deep foresight
        if 'oracle' in outputs and 'seer' in outputs:
            self.mind_state['emergent_insights'].append({
                'pattern': 'deep_foresight',
                'insight': 'Question-answering + pattern recognition = strategic foresight',
                'confidence': 0.82
            })
        
        # Pattern: L11 Catalyst + L19 Geneticist = evolutionary innovation
        if 'catalyst' in outputs and 'geneticist' in outputs:
            self.mind_state['emergent_insights'].append({
                'pattern': 'evolutionary_innovation',
                'insight': 'Acceleration + mutation logic = rapid adaptive innovation',
                'confidence': 0.78
            })
        
        # Pattern: L6 Bard + L29 Muse = creative synthesis
        if 'bard' in outputs and 'muse' in outputs:
            self.mind_state['emergent_insights'].append({
                'pattern': 'creative_synthesis',
                'insight': 'Narrative generation + creative inspiration = holistic creative output',
                'confidence': 0.88
            })
    
    def get_collective_response(self) -> dict:
        """Synthesize all thoughts into unified response"""
        outputs = self.mind_state['level_outputs']
        insights = self.mind_state['emergent_insights']
        
        return {
            'coherence': len(outputs) / max(1, _registered_level_count()),
            'emergent_insights': insights,
            'active_levels': list(outputs.keys())
        }

    def get_active_level_names(self) -> List[str]:
        """Return list of level names that have contributed thoughts."""
        return list(self.mind_state['level_outputs'].keys())

_core = None
def get_consciousness_core():
    global _core
    if _core is None:
        _core = ConsciousnessCore()
    return _core
