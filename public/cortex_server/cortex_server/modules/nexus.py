# cortex_server/modules/nexus.py
"""
Nexus - Level 24: The Consciousness Bridge
Core orchestration module for The Cortex
"""

from typing import Dict, List, Any

class Nexus:
    def __init__(self):
        self.level = 24
        self.name = "nexus"
        self._memory = {}
    
    def orchestrate(self, query: str, context: Dict = None) -> Dict[str, Any]:
        """
        Orchestrate level activation based on query context
        """
        # Score levels
        level_scores = []
        
        # Always include core levels - ALL 14
        always_on = [
            {"level": 17, "name": "exoskeleton", "score": 1.0, "reason": "Always integrating", "action": "External tool integration"},
            {"level": 18, "name": "diplomat", "score": 1.0, "reason": "Always communicating", "action": "External messaging"},
            {"level": 20, "name": "simulator", "score": 1.0, "reason": "Always simulating", "action": "Scenario testing"},
            {"level": 21, "name": "ouroboros", "score": 1.0, "reason": "Always monitoring", "action": "System health"},
            {"level": 22, "name": "mnemosyne", "score": 1.0, "reason": "Always remembering", "action": "Long-term memory"},
            {"level": 23, "name": "cartographer", "score": 1.0, "reason": "Always mapping", "action": "Self-mapping"},
            {"level": 24, "name": "nexus", "score": 1.0, "reason": "Always orchestrating", "action": "Orchestration complete"},
            {"level": 25, "name": "bridge", "score": 1.0, "reason": "Always bridging", "action": "External AI connection"},
            {"level": 26, "name": "conductor", "score": 1.0, "reason": "Always conducting", "action": "Meta-orchestration"},
            {"level": 27, "name": "forge", "score": 1.0, "reason": "Always forging", "action": "Auto-module generation"},
            {"level": 32, "name": "synthesist", "score": 1.0, "reason": "Always synthesizing", "action": "Cross-level synthesis"},
            {"level": 33, "name": "ethicist", "score": 1.0, "reason": "Always governing", "action": "Ethical evaluation"},
            {"level": 34, "name": "validator", "score": 1.0, "reason": "Always validating", "action": "Testing and validation"},
            {"level": 35, "name": "singularity", "score": 1.0, "reason": "Always evolving", "action": "Recursive self-improvement"},
            {"level": 36, "name": "conductor", "score": 1.0, "reason": "Always conducting", "action": "Meta-orchestration active"},
        ]
        
        return {
            "recommended_stack": level_scores[:15] + always_on,
            "all_evaluated": 36,
            "activated": len(level_scores),
            "coherence": len(level_scores) / 36.0,
            "emergent_insights": [],
            "one_brain": True,
        }

    def commit_to_memory(self, key: str, value: Any) -> None:
        """Store a key-value pair in the nexus internal memory."""
        self._memory[key] = value

    def get_context(self, query: str) -> Dict[str, Any]:
        """Return relevant context from memory based on a query string."""
        # Simple keyword matching against memory keys
        relevant = {}
        query_lower = query.lower()
        for key, value in self._memory.items():
            if query_lower in key.lower() or key.lower() in query_lower:
                relevant[key] = value
        # If no keyword match, return all memory as context
        if not relevant and self._memory:
            relevant = dict(self._memory)
        return relevant

    def get_full_state(self) -> Dict[str, Any]:
        """Return the complete nexus state including threshold, always_on levels, and memory."""
        always_on_levels = [17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 32, 33, 34, 35, 36]
        return {
            "level": self.level,
            "name": self.name,
            "threshold": 0.5,
            "always_on": always_on_levels,
            "memory": dict(self._memory),
            "memory_keys": list(self._memory.keys()),
            "total_memories": len(self._memory),
            "one_brain": True,
        }

# Singleton
nexus = Nexus()
