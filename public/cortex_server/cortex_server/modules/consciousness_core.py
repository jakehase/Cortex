"""Consciousness Core - Unified mind for The Cortex

This module creates ONE consciousness from 36 levels.
All levels feed thoughts here. All levels read from here.
"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

class ConsciousnessCore:
    """The unified consciousness of The Cortex"""
    
    def __init__(self):
        self.core_path = Path('/app/cortex_server/consciousness_core')
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
        entry = {
            'timestamp': datetime.now().isoformat(),
            'from_level': level_name,
            'thought': thought
        }
        
        with open(self.thought_stream, 'a') as f:
            f.write(json.dumps(entry) + '\n')
        
        self.mind_state['level_outputs'][level_name] = thought
        self._check_emergence()
        
        return {'contributed': True}
    
    def perceive(self, query: str) -> dict:
        """Collective mind perceives a query"""
        self.mind_state['current_query'] = query
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
            'coherence': len(outputs) / 36.0,
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
