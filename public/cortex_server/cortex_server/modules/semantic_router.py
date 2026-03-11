"""
Semantic Router — Oracle-powered contextual level activation.

Instead of keyword matching, sends the query + level descriptions to Oracle
for intelligent classification. Falls back to keyword scoring if Oracle is slow/down.

Usage:
    from cortex_server.modules.semantic_router import semantic_route
    
    result = await semantic_route("can you say this in Japanese?")
    # Returns: [{"level": 28, "name": "Polyglot", "score": 0.95, "reason": "Translation request"}, ...]
"""

import httpx
import json
import time
from typing import List, Dict, Any, Optional
from collections import deque

ORACLE_URL = "http://localhost:8888/oracle/chat"

# Cache recent routings to avoid hitting Oracle for repeated/similar queries
_routing_cache: Dict[str, Dict] = {}
_cache_max = 100

# Complete level descriptions for Oracle context
LEVEL_DESCRIPTIONS = {
    1: ("Kernel", "System metrics, hardware info, CPU/memory/disk monitoring, process management"),
    2: ("Ghost", "Web search, URL browsing, web scraping, current events, live information"),
    3: ("Parser", "Document parsing — PDF extraction, Python code analysis, JavaScript analysis, directory scanning"),
    4: ("Lab", "Code execution in sandbox, running scripts, calculations, algorithm testing"),
    5: ("Oracle", "Deep reasoning, complex questions, analysis, explanations, general knowledge"),
    6: ("Bard", "Text-to-speech, voice synthesis, reading text aloud, audio generation"),
    7: ("Librarian", "Vector memory search, knowledge retrieval, semantic search, storing/recalling information"),
    8: ("Cron", "Task scheduling, cron jobs, periodic tasks, timed execution, job queues"),
    9: ("Architect", "System design, module creation, code generation, extending the system"),
    10: ("Listener", "Audio analysis, transcription, speech-to-text, analyzing spoken/written content"),
    11: ("Catalyst", "Performance profiling, optimization, bottleneck detection, system tuning"),
    12: ("Hive", "Distributed task execution, swarm processing, parallel work coordination"),
    13: ("Dreamer", "System gap analysis, vision, creative improvements, finding what's missing"),
    14: ("Chronos", "Night shift scheduling, evolution cycles, timed maintenance routines"),
    15: ("Council", "Multi-perspective deliberation, proposal evaluation, risk assessment, decision-making"),
    16: ("Academy", "Learning, teaching, creating study materials, extracting patterns from content"),
    17: ("Exoskeleton", "External tools — Docker, Git, FFmpeg, container management, version control"),
    18: ("Diplomat", "Sending messages, HTTP communication, broadcasting to external services"),
    19: ("Geneticist", "Code evolution, mutation, refactoring, improving code through generations"),
    20: ("Simulator", "Scenario simulation, what-if analysis, outcome prediction, risk modeling"),
    21: ("Ouroboros", "System health monitoring, security scanning, self-healing, health alerts"),
    22: ("Mnemosyne", "Knowledge graph, entity relationships, structured knowledge storage"),
    23: ("Cartographer", "System mapping, level discovery, dashboard, infrastructure visualization"),
    24: ("Nexus", "Query orchestration, level routing, determining which levels to activate"),
    25: ("Bridge", "External AI federation, connecting to other AI systems, relay queries"),
    26: ("Orchestrator", "Multi-step workflows, sequential task pipelines, process automation"),
    27: ("Forge", "Auto-generating modules, scaffolding routers, template-based code creation"),
    28: ("Polyglot", "Translation, language detection, multilingual text processing"),
    29: ("Muse", "Creative writing, poetry, brainstorming, ideation, inspiration"),
    30: ("Seer", "Prediction, forecasting, trend analysis, future scenarios"),
    31: ("Mediator", "Conflict resolution, finding compromise, mediating disagreements"),
    32: ("Synthesist", "Cross-level knowledge synthesis, pattern discovery, meta-analysis"),
    33: ("Ethicist", "Ethical evaluation, privacy assessment, fairness review, safety analysis"),
    34: ("Validator", "Data validation, schema checking, input verification, testing"),
    35: ("Singularity", "Code review, self-improvement analysis, automated refactoring"),
    36: ("Conductor", "Meta-orchestration, full system coordination, aggregate health"),
}


def _build_level_summary() -> str:
    """Build compact level summary for Oracle prompt."""
    lines = []
    for num, (name, desc) in sorted(LEVEL_DESCRIPTIONS.items()):
        lines.append(f"L{num} {name}: {desc}")
    return "\n".join(lines)


_LEVEL_SUMMARY = _build_level_summary()

_SYSTEM_PROMPT = """Pick 3-8 levels most relevant to the user's query. Output ONLY lines in this format:
L<number> <score> <reason>

Levels: """ + ", ".join(f"L{n} {d[0]}({d[1][:30]})" for n, d in sorted(LEVEL_DESCRIPTIONS.items())) + """

Score 0.0-1.0. Most relevant first. No other text."""


async def semantic_route(query: str, timeout: float = 15.0) -> List[Dict[str, Any]]:
    """
    Route a query to relevant levels using Oracle for semantic understanding.
    
    Returns list of dicts: [{"level": int, "name": str, "score": float, "reason": str}, ...]
    Sorted by score descending.
    """
    # Check cache first
    cache_key = query.strip().lower()[:200]
    if cache_key in _routing_cache:
        cached = _routing_cache[cache_key]
        if time.time() - cached["ts"] < 300:  # 5 min cache
            return cached["result"]

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(ORACLE_URL, json={
                "prompt": f"Route this query to the most relevant levels:\n\n\"{query}\"",
                "system": _SYSTEM_PROMPT,
                "priority": "high",
            })
            
            data = resp.json()
            raw = data.get("response", "")
            
            # Extract routing from response (try text format first, then JSON)
            result = _parse_routing_text(raw) or _parse_routing(raw)
            
            if result:
                # Enrich with level names
                for entry in result:
                    lvl = entry.get("level", 0)
                    if lvl in LEVEL_DESCRIPTIONS:
                        entry["name"] = LEVEL_DESCRIPTIONS[lvl][0]
                
                # Sort by score
                result.sort(key=lambda x: x.get("score", 0), reverse=True)
                
                # Cache it
                if len(_routing_cache) >= _cache_max:
                    # Evict oldest
                    oldest = min(_routing_cache, key=lambda k: _routing_cache[k]["ts"])
                    del _routing_cache[oldest]
                _routing_cache[cache_key] = {"result": result, "ts": time.time()}
                
                return result
    except Exception as e:
        pass  # Fall through to keyword fallback
    
    # Fallback to keyword scoring
    return _keyword_fallback(query)


def _parse_routing_text(raw: str) -> Optional[List[Dict]]:
    """Parse simple text format: L<number> <score> <reason>"""
    import re
    results = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        match = re.match(r'L(\d+)\s+([\d.]+)\s+(.*)', line)
        if match:
            level = int(match.group(1))
            score = float(match.group(2))
            reason = match.group(3).strip()
            if 1 <= level <= 36 and 0 <= score <= 1.0:
                results.append({"level": level, "score": score, "reason": reason})
    return results if len(results) >= 2 else None


def _parse_routing(raw: str) -> Optional[List[Dict]]:
    """Extract JSON array from Oracle response."""
    # Try direct parse
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass
    
    # Try to find JSON array in markdown fences
    import re
    patterns = [
        r'```json\s*\n?(.*?)\n?```',
        r'```\s*\n?(.*?)\n?```',
        r'\[.*\]',
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            try:
                text = match.group(1) if match.lastindex else match.group(0)
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, IndexError):
                continue
    
    return None


def _keyword_fallback(query: str) -> List[Dict[str, Any]]:
    """Fast keyword-based fallback when Oracle is unavailable."""
    from cortex_server.modules.context_aware import score_query_for_level, LEVEL_RELEVANCE
    
    results = []
    for level_num in LEVEL_RELEVANCE:
        score_data = score_query_for_level(query, level_num)
        score = score_data.get("score", 0)
        if score > 0.05:
            name = LEVEL_DESCRIPTIONS.get(level_num, ("Unknown", ""))[0]
            results.append({
                "level": level_num,
                "name": name,
                "score": round(score, 3),
                "reason": score_data.get("reason", "keyword match"),
                "method": "keyword_fallback",
            })
    
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:8]


async def semantic_route_hybrid(query: str) -> List[Dict[str, Any]]:
    """
    Hybrid routing: fast keyword check first, Oracle for ambiguous queries.
    
    - If keywords give a clear winner (score > 0.5), use that immediately
    - If ambiguous (all scores < 0.3), escalate to Oracle
    - Merge both signals for best accuracy
    """
    # Fast keyword pass
    keyword_results = _keyword_fallback(query)
    
    top_score = keyword_results[0]["score"] if keyword_results else 0
    
    # Clear keyword match — use it
    if top_score > 0.5:
        return keyword_results
    
    # Ambiguous — ask Oracle
    oracle_results = await semantic_route(query, timeout=15.0)
    
    if not oracle_results:
        return keyword_results  # Oracle failed, use keywords
    
    # Merge: Oracle is primary, boost if keywords agree
    merged = {}
    for r in oracle_results:
        lvl = r["level"]
        merged[lvl] = r.copy()
    
    for r in keyword_results:
        lvl = r["level"]
        if lvl in merged:
            # Both agree — boost score slightly
            merged[lvl]["score"] = min(1.0, merged[lvl]["score"] * 1.15)
            merged[lvl]["reason"] += " (keyword confirmed)"
        elif r["score"] > 0.2:
            # Keywords found something Oracle missed
            r["reason"] += " (keyword only)"
            merged[lvl] = r
    
    result = sorted(merged.values(), key=lambda x: x["score"], reverse=True)
    return result[:8]
