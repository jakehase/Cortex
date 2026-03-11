"""Context-Aware Orchestration - All 36 levels evaluate relevance with semantic understanding"""

# from .semantic_scorer import get_semantic_scorer  # Disabled - numpy not installed

# Complete LEVEL_RELEVANCE - All 36 levels with keyword configurations
LEVEL_RELEVANCE = {
    1: {  # Kernel
        'terms': ['system', 'hardware', 'os', 'kernel', 'process', 'cpu', 'memory'],
        'weight': 0.15,
        'action': 'System operations'
    },
    2: {  # Ghost
        'terms': ['search', 'web', 'url', 'http', 'browse', 'current', 'latest', 'today'],
        'weight': 0.2,
        'action': 'Web browsing'
    },
    3: {  # Parser
        'terms': ['parse', 'extract', 'document', 'pdf', 'text', 'structure', 'format'],
        'weight': 0.3,
        'action': 'Document parsing'
    },
    4: {  # Lab
        'terms': ['code', 'script', 'python', 'calculate', 'compute', 'math', 'algorithm'],
        'weight': 0.2,
        'action': 'Code execution'
    },
    5: {  # Oracle
        'terms': ['explain', 'why', 'how', 'analyze', 'understand', '?'],
        'weight': 0.15,
        'action': 'LLM reasoning'
    },
    6: {  # Bard
        'terms': ['speak', 'voice', 'read aloud', 'say', 'audio', 'tts'],
        'weight': 0.4,
        'action': 'Text-to-speech'
    },
    7: {  # Librarian
        'terms': ['remember', 'recall', 'previous', 'before', 'stored', 'knowledge'],
        'weight': 0.4,
        'action': 'Knowledge retrieval'
    },
    8: {  # Cron
        'terms': ['schedule', 'cron', 'timer', 'periodic', 'job', 'task', 'queue'],
        'weight': 0.4,
        'action': 'Task scheduling'
    },
    9: {  # Architect
        'terms': ['build', 'design', 'system', 'architecture', 'structure', 'implement', 'create', 'module', 'level'],
        'weight': 0.3,
        'action': 'System design'
    },
    10: {  # Listener
        'terms': ['listen', 'speech', 'stt', 'voice input', 'transcribe'],
        'weight': 0.4,
        'action': 'Speech-to-text'
    },
    11: {  # Catalyst
        'terms': ['optimize', 'performance', 'speed', 'fast', 'slow', 'efficiency'],
        'weight': 0.3,
        'action': 'Performance optimization'
    },
    12: {  # Darwin
        'terms': ['improve', 'evolve', 'better', 'enhance', 'upgrade', 'heal', 'fix'],
        'weight': 0.25,
        'action': 'Evolution optimization'
    },
    13: {  # Dreamer
        'terms': ['imagine', 'what if', 'future', 'potential', 'vision', 'create new', 'dream'],
        'weight': 0.3,
        'action': 'Vision exploration'
    },
    14: {  # Chronos
        'terms': ['schedule', 'time', 'when', 'daily', 'recurring', 'timer', 'cron'],
        'weight': 0.35,
        'action': 'Temporal scheduling'
    },
    15: {  # Council
        'terms': ['delete', 'remove', 'destroy', 'wipe', 'erase', 'kill', 'dangerous'],
        'weight': 0.5,
        'action': 'Safety review'
    },
    16: {  # Academy
        'terms': ['learn', 'teach', 'explain in detail', 'comprehensive', 'course', 'study'],
        'weight': 0.25,
        'action': 'Learning mode'
    },
    17: {  # Exoskeleton
        'terms': ['docker', 'container', 'deploy', 'environment', 'isolation'],
        'weight': 0.3,
        'action': 'Container management'
    },
    18: {  # Diplomat
        'terms': ['send', 'email', 'message', 'notify', 'alert', 'contact', 'communicate'],
        'weight': 0.35,
        'action': 'External communication'
    },
    19: {  # Geneticist
        'terms': ['version', 'git', 'evolve', 'branch', 'history', 'lineage'],
        'weight': 0.25,
        'action': 'Version management'
    },
    20: {  # Simulator
        'terms': ['test', 'simulate', 'what if scenario', 'predict outcome', 'sandbox'],
        'weight': 0.3,
        'action': 'Simulation testing'
    },
    21: {  # Ouroboros
        'terms': ['regenerate', 'self-heal', 'maintain', 'health check'],
        'weight': 0.2,
        'action': 'System health'
    },
    22: {  # Mnemosyne
        'terms': ['memory', 'remember', 'growth', 'pattern', 'learn from'],
        'weight': 0.3,
        'action': 'Memory pattern analysis'
    },
    23: {  # Cartographer
        'terms': ['map', 'discover', 'explore', 'structure', 'system map'],
        'weight': 0.25,
        'action': 'Self-mapping'
    },
    24: {  # Nexus
        'terms': ['coordinate', 'orchestrate', 'manage', 'direct', 'control'],
        'weight': 0.3,
        'action': 'Orchestration'
    },
    25: {  # Bridge
        'terms': ['federation', 'connect', 'bridge', 'external agent', 'collaborate'],
        'weight': 0.35,
        'action': 'Multi-agent federation'
    },
    26: {  # Conductor
        'terms': ['workflow', 'pipeline', 'sequence', 'steps', 'automate'],
        'weight': 0.35,
        'action': 'Workflow orchestration'
    },
    27: {  # Forge
        'terms': ['generate', 'create module', 'auto-build', 'scaffold', 'template'],
        'weight': 0.4,
        'action': 'Module generation'
    },
    28: {  # Polyglot
        'terms': ['translate', 'language', 'multilingual', 'french', 'spanish', 'german', 'chinese'],
        'weight': 0.35,
        'action': 'Multi-language support'
    },
    29: {  # Muse
        'terms': ['creative', 'inspire', 'write', 'poem', 'story', 'art', 'design', 'idea'],
        'weight': 0.3,
        'action': 'Creative inspiration'
    },
    30: {  # Seer
        'terms': ['predict', 'forecast', 'trend', 'future', 'anticipate', 'projection'],
        'weight': 0.35,
        'action': 'Predictive analysis'
    },
    31: {  # Mediator
        'terms': ['resolve', 'conflict', 'negotiate', 'mediate', 'dispute', 'agreement'],
        'weight': 0.3,
        'action': 'Conflict resolution'
    },
    32: {  # Synthesist
        'terms': ['synthesize', 'combine', 'integrate', 'holistic', 'meta', 'pattern'],
        'weight': 0.3,
        'action': 'Knowledge synthesis'
    },
    33: {  # Ethicist
        'terms': ['ethical', 'moral', 'right thing', 'should we', 'concern', 'risk'],
        'weight': 0.35,
        'action': 'Ethical review'
    },
    34: {  # Validator
        'terms': ['validate', 'test', 'verify', 'check', 'safe', 'rollback'],
        'weight': 0.3,
        'action': 'Validation testing'
    },
    35: {  # Singularity
        'terms': ['self-improve', 'recursive', 'evolve myself', 'modify own code'],
        'weight': 0.4,
        'action': 'Self-modification'
    },
    36: {  # Conductor (Meta-orchestration)
        'terms': ['orchestrate', 'conduct', 'coordinate', 'synchronize', 'harmonize', 'unify', 'integrate', 'collective', 'symphony', 'ensemble'],
        'weight': 0.45,
        'action': 'Meta-orchestration'
    }
}

# Get semantic scorer instance
_semantic_scorer = None

def get_scorer():
    global _semantic_scorer
    if _semantic_scorer is None:
        raise RuntimeError("Semantic scorer not available (numpy not installed)")
    return _semantic_scorer

def score_query_for_level(query: str, level_num: int) -> dict:
    """
    Score how relevant a query is to a specific level using semantic understanding.
    Falls back to keyword matching if semantic scorer unavailable.
    """
    # Try semantic scoring first
    try:
        scorer = get_scorer()
        result = scorer.score_semantic(query, level_num)
        
        # Enhance with legacy action info
        if level_num in LEVEL_RELEVANCE:
            result['action'] = LEVEL_RELEVANCE[level_num].get('action')
        
        return result
    except Exception as e:
        print(f"[CONTEXT] Semantic scoring failed: {e}, using fallback")
        return _keyword_fallback(query, level_num)

def _keyword_fallback(query: str, level_num: int) -> dict:
    """Legacy keyword-based scoring as fallback"""
    if level_num not in LEVEL_RELEVANCE:
        return {'score': 0.05, 'reason': 'Level not configured', 'action': None}
    
    config = LEVEL_RELEVANCE[level_num]
    query_lower = query.lower()
    query_words = set(query_lower.split())
    
    # Flexible matching
    matches = 0
    matched_terms = []
    
    for term in config['terms']:
        term_lower = term.lower()
        if term_lower in query_lower:
            matches += 1
            matched_terms.append(term)
        elif len(term_lower) > 3 and any(term_lower in word for word in query_words):
            matches += 0.5
            matched_terms.append(f"{term} (partial)")
        elif len(term_lower) > 4 and any(word.startswith(term_lower) for word in query_words):
            matches += 0.7
            matched_terms.append(f"{term} (stem)")
    
    # Boost for multi-word matches
    if matches >= 2:
        matches *= 1.2
    
    if matches > 0:
        score = min(matches * config['weight'], 1.0)
        reason = f"{len(matched_terms)} relevance indicators"
    else:
        score = 0.005
        reason = "Baseline activation"
    
    # Ensure all levels participate
    if score < 0.005:
        score = 0.005
    
    return {'score': score, 'reason': reason, 'action': config.get('action')}

def get_all_level_configs():
    """Return configurations for all 36 levels"""
    return LEVEL_RELEVANCE

def get_configured_level_count():
    """Return count of configured levels"""
    return len(LEVEL_RELEVANCE)
