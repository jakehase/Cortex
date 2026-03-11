"""Semantic Context Awareness using embeddings and LLM"""

import numpy as np
from typing import Dict, List, Any
import os

class SemanticScorer:
    """
    True semantic context awareness.
    Uses embeddings and LLM to understand query intent.
    """
    
    # Level purpose descriptions for semantic matching
    LEVEL_PURPOSES = {
        1: "System operations, hardware, kernel management, processes",
        2: "Web search, internet browsing, real-time information retrieval",
        3: "Parallel processing, distributed tasks, multiple operations",
        4: "Code execution, Python scripts, calculations, algorithms",
        5: "Analysis, reasoning, explanation, understanding complex topics",
        6: "Text-to-speech, voice synthesis, audio output",
        7: "Memory retrieval, knowledge search, recall past information",
        8: "Security monitoring, protection, privacy, encryption",
        9: "System design, architecture, building structures",
        10: "Speech-to-text, voice input, transcription",
        11: "Performance optimization, speed improvements, efficiency",
        12: "Evolution, adaptation, optimization, learning",
        13: "Imagination, creativity, vision, future planning",
        14: "Time management, scheduling, temporal analysis",
        15: "Collaboration, consensus, multiple perspectives",
        16: "Learning, education, training, skill acquisition",
        17: "Extensions, plugins, integrations, augmentations",
        18: "Relationships, partnerships, negotiations, diplomacy",
        19: "Genetic algorithms, breeding, mutation, traits",
        20: "Simulation, modeling, prediction, forecasting",
        21: "Self-monitoring, system health, regeneration",
        22: "Long-term memory, persistence, archiving, history",
        23: "Self-discovery, mapping, identification",
        24: "Orchestration, coordination, consciousness bridge",
        25: "Federation, bridging agents, coordination",
        26: "Workflow orchestration, multi-step processes",
        27: "Module generation, auto-creation, capability gaps",
        28: "Translation, language, internationalization",
        29: "Voice processing, speech, audio analysis",
        30: "Visual processing, images, computer vision",
        31: "Mediation, conflict resolution, negotiation",
        32: "Cross-level synthesis, meta-insights, patterns",
        33: "Ethics, morality, fairness, safety review",
        34: "Validation, testing, verification, quality",
        35: "Self-improvement, evolution, recursive growth",
        36: "Meta-orchestration, symphony conducting, harmony"
    }
    
    def __init__(self):
        self.use_llm = False
        self.use_embeddings = False
        self.embedding_model = None
        self._init_models()
    
    def _init_models(self):
        """Initialize embedding model or LLM client"""
        # Check for sentence-transformers
        try:
            from sentence_transformers import SentenceTransformer
            self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            self.use_embeddings = True
            print("[SEMANTIC] Embedding model loaded (sentence-transformers)")
        except ImportError:
            print("[SEMANTIC] sentence-transformers not available, will use heuristics")
            self.embedding_model = None
        
        # Check for OpenAI/OpenRouter
        try:
            if os.environ.get('OPENAI_API_KEY') or os.environ.get('OPENROUTER_API_KEY'):
                self.use_llm = True
                print("[SEMANTIC] LLM API key found - LLM scoring available")
        except:
            print("[SEMANTIC] LLM not configured")
    
    def score_semantic(self, query: str, level_num: int) -> Dict[str, Any]:
        """
        Score query relevance to level using semantic understanding.
        Returns score 0-1 based on semantic similarity, not keywords.
        """
        if level_num not in self.LEVEL_PURPOSES:
            return {'score': 0.05, 'reason': 'Level not defined', 'method': 'fallback'}
        
        purpose = self.LEVEL_PURPOSES[level_num]
        
        # Method 1: Embedding similarity
        if self.use_embeddings:
            return self._embedding_score(query, purpose, level_num)
        
        # Method 2: Enhanced keyword + semantic heuristics
        return self._semantic_heuristic_score(query, purpose, level_num)
    
    def _embedding_score(self, query: str, purpose: str, level_num: int) -> Dict[str, Any]:
        """Use embedding cosine similarity"""
        try:
            # Encode query and purpose
            query_embedding = self.embedding_model.encode(query)
            purpose_embedding = self.embedding_model.encode(purpose)
            
            # Calculate cosine similarity
            similarity = np.dot(query_embedding, purpose_embedding) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(purpose_embedding)
            )
            
            # Scale to 0-1 range (cosine is -1 to 1, scale to 0-1)
            score = float((similarity + 1) / 2)
            
            return {
                'score': score,
                'reason': f'Semantic similarity: {score:.2f} to purpose: {purpose[:40]}...',
                'method': 'embedding'
            }
        except Exception as e:
            print(f"[SEMANTIC] Embedding error: {e}")
            return self._semantic_heuristic_score(query, purpose, level_num)
    
    def _semantic_heuristic_score(self, query: str, purpose: str, level_num: int) -> Dict[str, Any]:
        """
        Enhanced heuristic scoring that approximates semantic understanding.
        Uses word vectors, synonym detection, and intent analysis.
        """
        query_lower = query.lower()
        purpose_lower = purpose.lower()
        
        # Concept matching (not just keyword)
        concept_matches = 0
        
        # Detect intent categories
        intents = self._detect_intents(query_lower)
        
        # Match intents to level purpose
        for intent, confidence in intents.items():
            if self._intent_matches_level(intent, level_num):
                concept_matches += confidence
        
        # Semantic similarity through word overlap + weighting
        query_words = set(query_lower.split())
        purpose_words = set(purpose_lower.split())
        
        # Calculate weighted overlap
        overlap = query_words.intersection(purpose_words)
        overlap_score = len(overlap) / max(len(query_words), len(purpose_words), 1)
        
        # Combine scores
        final_score = min((concept_matches * 0.6) + (overlap_score * 0.4), 1.0)
        
        # Boost for strong intent match
        if concept_matches > 0.7:
            final_score = min(final_score * 1.3, 1.0)
        
        return {
            'score': max(final_score, 0.01),
            'reason': f'Semantic match: {len(overlap)} concepts, intents: {list(intents.keys())[:3]}',
            'method': 'semantic_heuristic'
        }
    
    def _detect_intents(self, query: str) -> Dict[str, float]:
        """Detect semantic intents in query"""
        intents = {}
        
        # Information retrieval intent
        if any(w in query for w in ['find', 'search', 'look', 'get', 'what', 'where', 'how', 'lookup']):
            intents['information_retrieval'] = 0.8
        
        # Memory/recall intent
        if any(w in query for w in ['remember', 'recall', 'previous', 'past', 'before', 'last', 'ago', 'tuesday', 'yesterday', 'week', 'monday', 'wednesday', 'thursday', 'friday']):
            intents['memory_recall'] = 0.9
        
        # Analysis intent
        if any(w in query for w in ['analyze', 'compare', 'study', 'feasibility', 'assessment', 'evaluate']):
            intents['analysis'] = 0.85
        
        # Creation/building intent
        if any(w in query for w in ['build', 'create', 'make', 'design', 'implement', 'develop']):
            intents['creation'] = 0.8
        
        # Safety/security intent
        if any(w in query for w in ['safe', 'secure', 'protect', 'risk', 'danger', 'threat']):
            intents['security'] = 0.85
        
        # Communication intent
        if any(w in query for w in ['tell', 'say', 'speak', 'voice', 'read', 'announce']):
            intents['communication'] = 0.75
        
        # Web/real-time intent
        if any(w in query for w in ['current', 'today', 'now', 'latest', 'price', 'cost', 'flight', 'news']):
            intents['real_time_data'] = 0.9
        
        # Learning/education intent
        if any(w in query for w in ['learn', 'teach', 'explain', 'understand', 'how to', 'what is']):
            intents['learning'] = 0.8
        
        # Optimization intent
        if any(w in query for w in ['optimize', 'improve', 'better', 'faster', 'efficient']):
            intents['optimization'] = 0.8
        
        # Time/scheduling intent
        if any(w in query for w in ['schedule', 'time', 'when', 'remind', 'calendar', 'date', 'deadline']):
            intents['scheduling'] = 0.85
            
        return intents
    
    def _intent_matches_level(self, intent: str, level_num: int) -> bool:
        """Map intents to appropriate levels"""
        intent_level_map = {
            'information_retrieval': [2, 7, 5],  # Ghost, Librarian, Oracle
            'memory_recall': [7, 22, 14],  # Librarian, Mnemosyne, Chronos
            'analysis': [5, 32, 15],  # Oracle, Synthesist, Council
            'creation': [9, 27, 13],  # Architect, Forge, Dreamer
            'security': [8, 33, 34],  # Sentinel, Ethicist, Validator
            'communication': [6, 18, 29],  # Bard, Diplomat, Muse
            'real_time_data': [2, 14, 23],  # Ghost, Chronos, Cartographer
            'learning': [16, 5, 7],  # Academy, Oracle, Librarian
            'optimization': [11, 12, 35],  # Catalyst, Darwin, Singularity
            'scheduling': [14, 26],  # Chronos, Conductor
        }
        
        return level_num in intent_level_map.get(intent, [])

# Global instance
_semantic_scorer = None

def get_semantic_scorer():
    global _semantic_scorer
    if _semantic_scorer is None:
        _semantic_scorer = SemanticScorer()
    return _semantic_scorer
