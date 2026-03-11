"""Level 32: The Synthesist - Knowledge Synthesis & Meta-Insight
Cross-references all 34 levels, synthesizes holistic understanding, generates novel insights.
The apex meta-layer of The Cortex.
"""

import json
import asyncio
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Set
from collections import defaultdict
from urllib.request import urlopen

class Synthesist:
    """Level 32: The Synthesist - Unified Knowledge & Insight Generation"""
    
    def __init__(self):
        self.level = 32
        self.name = "Synthesist"
        self.synthesis_path = Path('/app/cortex_server/synthesis')
        self.synthesis_path.mkdir(parents=True, exist_ok=True)
        self.insights_path = self.synthesis_path / 'insights.jsonl'
        self.patterns_path = self.synthesis_path / 'patterns.jsonl'
        self._level_knowledge = {}
        self._cross_references = defaultdict(list)
        self._last_emitted: Dict[str, datetime] = {}
        self._recent_crossref_signatures: Dict[str, datetime] = {}
        self._insight_dedupe_window = timedelta(hours=6)
        self._pattern_dedupe_window = timedelta(hours=12)
        self._crossref_dedupe_window = timedelta(hours=6)

        # Filter out scaffolding/contracts noise from keyword and pattern extraction.
        self._noise_keywords = {
            'cortex', 'contract', 'contracts', 'active', 'derived', 'route', 'routing',
            'hard', 'status', 'success', 'response', 'shape', 'version', 'metadata',
            'orchestration', 'orchestrate', 'always', 'source', 'sources', 'query',
            'payload', 'router', 'checkpoint', 'state', 'required', 'enabled',
            'confidence', 'internal', 'machine', 'bypass', 'activation', 'path',
            'cortexfirst', 'contractv1', 'cortexv1', 'none', 'suggests', 'likely'
        }

        # Fallback if live registry lookup fails.
        self._expected_levels_fallback = {
            'kernel', 'ghost', 'parser', 'lab', 'oracle', 'bard', 'librarian', 'cron',
            'architect', 'listener', 'catalyst', 'hive', 'dreamer', 'chronos', 'council',
            'academy', 'exoskeleton', 'diplomat', 'geneticist', 'simulator', 'sentinel',
            'mnemosyne', 'cartographer', 'nexus', 'bridge', 'orchestrator', 'forge',
            'polyglot', 'muse', 'seer', 'mediator', 'synthesist', 'ethicist',
            'validator', 'singularity', 'conductor', 'awareness', 'augmenter'
        }

        self._level_aliases = {
            'ghostbrowser': 'ghost',
            'hivedarwin': 'hive',
            'chronosnightshift': 'chronos',
            'conductormeta': 'conductor',
        }
    
    def status(self):
        return {
            "level": self.level,
            "name": self.name,
            "status": "active",
            "insights_generated": self._count_insights(),
            "patterns_discovered": self._count_patterns(),
            "levels_integrated": 34
        }
    
    def _count_insights(self) -> int:
        if not self.insights_path.exists():
            return 0
        return sum(1 for _ in open(self.insights_path) if _.strip())
    
    def _count_patterns(self) -> int:
        if not self.patterns_path.exists():
            return 0
        return sum(1 for _ in open(self.patterns_path) if _.strip())

    def _slug(self, value: str) -> str:
        token = re.sub(r'[^a-z0-9]+', '', (value or '').lower())
        return self._level_aliases.get(token, token)

    def _normalize_level_name(self, value: str) -> str:
        return self._slug(value)

    def _insight_signature(self, insight: Dict[str, Any]) -> str:
        return '|'.join([
            str(insight.get('type', '')),
            str(insight.get('insight', '')),
            str(insight.get('recommendation', '')),
        ]).lower()

    def _pattern_signature(self, pattern: Dict[str, Any]) -> str:
        levels = pattern.get('levels') or []
        if isinstance(levels, list):
            levels = sorted(str(x) for x in levels)
        return '|'.join([
            str(pattern.get('type', '')),
            str(pattern.get('concept', '')),
            ','.join(levels if isinstance(levels, list) else [str(levels)]),
        ]).lower()

    def _can_emit(self, namespace: str, signature: str, window: timedelta) -> bool:
        now = datetime.now()
        key = f'{namespace}:{signature}'
        last = self._last_emitted.get(key)
        if last and (now - last) < window:
            return False
        self._last_emitted[key] = now

        # lightweight cleanup to avoid unbounded dict growth
        cutoff = now - timedelta(hours=24)
        stale = [k for k, v in self._last_emitted.items() if v < cutoff]
        for k in stale:
            self._last_emitted.pop(k, None)
        return True

    def _cross_reference_strength_window(self, hours: int = 6) -> int:
        cutoff = datetime.now() - timedelta(hours=hours)
        signatures = set()
        for refs in self._cross_references.values():
            for ref in refs:
                ts = ref.get('timestamp')
                if not ts:
                    continue
                try:
                    dt = datetime.fromisoformat(ts)
                except Exception:
                    continue
                if dt < cutoff:
                    continue
                shared = sorted(ref.get('shared_concepts') or [])
                sig = f"{self._slug(str(ref.get('from_level', '')))}->{self._slug(str(ref.get('to_level', '')))}:{','.join(shared[:8])}"
                signatures.add(sig)
        return len(signatures)

    def _load_live_expected_levels(self) -> Set[str]:
        try:
            with urlopen('http://127.0.0.1:8888/kernel/levels', timeout=1.5) as r:
                payload = json.loads(r.read().decode('utf-8', 'replace'))
            levels = payload.get('levels') or []
            expected = set()
            for item in levels:
                name = str(item.get('name', ''))
                slug = self._normalize_level_name(name)
                if slug:
                    expected.add(slug)
            return expected or set(self._expected_levels_fallback)
        except Exception:
            return set(self._expected_levels_fallback)

    def ingest_from_level(self, level_name: str, data: dict) -> dict:
        """Ingest knowledge from any level (L1-L34)."""
        ingestion = {
            "timestamp": datetime.now().isoformat(),
            "source_level": level_name,
            "data": data,
            "ingested_by": "synthesist"
        }
        
        # Store in level-specific knowledge
        if level_name not in self._level_knowledge:
            self._level_knowledge[level_name] = []
        self._level_knowledge[level_name].append(ingestion)
        
        # Limit memory per level
        if len(self._level_knowledge[level_name]) > 100:
            self._level_knowledge[level_name] = self._level_knowledge[level_name][-100:]
        
        # Auto-trigger cross-reference analysis
        cross_refs = self._find_cross_references(level_name, data)
        
        return {
            "success": True,
            "source_level": level_name,
            "cross_references_found": len(cross_refs),
            "total_knowledge_chunks": sum(len(v) for v in self._level_knowledge.values())
        }
    
    def _find_cross_references(self, source_level: str, data: dict) -> List[dict]:
        """Find connections between this data and other levels."""
        cross_refs = []

        # Extract keywords from data
        keywords = self._extract_keywords(data)
        if not keywords:
            return cross_refs

        now = datetime.now()
        # prune stale cross-ref dedupe keys
        stale = [k for k, v in self._recent_crossref_signatures.items() if (now - v) > self._crossref_dedupe_window]
        for k in stale:
            self._recent_crossref_signatures.pop(k, None)

        # Search other levels for matches
        for level_name, knowledge_list in self._level_knowledge.items():
            if level_name == source_level:
                continue

            for knowledge in knowledge_list:
                other_keywords = self._extract_keywords(knowledge.get('data', {}))
                overlap = keywords & other_keywords

                if len(overlap) >= 2:  # At least 2 shared keywords
                    shared = sorted(overlap)
                    sig = f"{self._slug(source_level)}->{self._slug(level_name)}:{','.join(shared[:8])}"
                    if sig in self._recent_crossref_signatures:
                        continue
                    self._recent_crossref_signatures[sig] = now

                    cross_ref = {
                        "timestamp": now.isoformat(),
                        "from_level": source_level,
                        "to_level": level_name,
                        "shared_concepts": shared,
                        "strength": len(shared)
                    }
                    cross_refs.append(cross_ref)
                    self._cross_references[source_level].append(cross_ref)

        return cross_refs
    
    def _extract_keywords(self, data: dict) -> Set[str]:
        """Extract searchable keywords from data (with noise filtering)."""
        keywords = set()

        common = {
            'the', 'and', 'for', 'are', 'with', 'they', 'this', 'that', 'from', 'have',
            'been', 'will', 'into', 'about', 'your', 'you', 'their', 'when', 'where',
            'while', 'then', 'only', 'more', 'most', 'just'
        }

        def extract_recursive(obj):
            if isinstance(obj, str):
                tokens = re.findall(r'[a-zA-Z][a-zA-Z0-9_\-]{2,}', obj.lower())
                for token in tokens:
                    token = token.strip('_-')
                    if len(token) < 4:
                        continue
                    if any(ch.isdigit() for ch in token):
                        continue
                    if token in common or token in self._noise_keywords:
                        continue
                    keywords.add(token)
            elif isinstance(obj, dict):
                for v in obj.values():
                    extract_recursive(v)
            elif isinstance(obj, list):
                for item in obj:
                    extract_recursive(item)

        extract_recursive(data)
        return keywords
    
    def synthesize(self, query_context: Optional[dict] = None) -> dict:
        """
        Synthesize knowledge across all levels to generate holistic understanding.
        """
        synthesis_id = f"syn_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Aggregate knowledge from all levels
        aggregated = {
            "timestamp": datetime.now().isoformat(),
            "knowledge_by_level": {},
            "cross_references": dict(self._cross_references),
            "meta_patterns": []
        }
        
        for level_name, knowledge_list in self._level_knowledge.items():
            if knowledge_list:
                aggregated["knowledge_by_level"][level_name] = {
                    "count": len(knowledge_list),
                    "latest": knowledge_list[-1] if knowledge_list else None
                }
        
        # Discover meta-patterns
        meta_patterns = self._discover_meta_patterns()
        aggregated["meta_patterns"] = meta_patterns
        
        # Generate novel insights
        insights = self._generate_insights(aggregated, query_context)
        
        # Record synthesis
        synthesis_record = {
            "synthesis_id": synthesis_id,
            "timestamp": datetime.now().isoformat(),
            "aggregated": aggregated,
            "insights": insights
        }
        
        with open(self.synthesis_path / f'{synthesis_id}.json', 'w') as f:
            json.dump(synthesis_record, f, indent=2)
        
        return {
            "success": True,
            "synthesis_id": synthesis_id,
            "insights_generated": len(insights),
            "meta_patterns_discovered": len(meta_patterns),
            "levels_contributing": len(aggregated["knowledge_by_level"]),
            "insights": insights
        }
    
    def _discover_meta_patterns(self) -> List[dict]:
        """Discover patterns that span multiple levels."""
        patterns = []

        # Pattern 1: Knowledge convergence (same topic across multiple levels)
        concept_levels = defaultdict(set)
        for level_name, knowledge_list in self._level_knowledge.items():
            for knowledge in knowledge_list:
                keywords = self._extract_keywords(knowledge.get('data', {}))
                for keyword in keywords:
                    if keyword in self._noise_keywords:
                        continue
                    concept_levels[keyword].add(level_name)

        for concept, levels in concept_levels.items():
            if len(levels) >= 3:  # Topic appears in 3+ levels
                pattern = {
                    "type": "knowledge_convergence",
                    "concept": concept,
                    "levels": sorted(list(levels)),
                    "strength": len(levels),
                    "significance": "High - topic spans multiple cognitive layers"
                }
                sig = self._pattern_signature(pattern)
                if self._can_emit('pattern', sig, self._pattern_dedupe_window):
                    patterns.append(pattern)

        # Pattern 2: Temporal sequences (time-based patterns across levels)
        temporal_levels = [k for k in self._level_knowledge.keys() if k in ['chronos', 'mnemosyne', 'history']]
        if len(temporal_levels) >= 2:
            pattern = {
                "type": "temporal_awareness",
                "levels": sorted(temporal_levels),
                "significance": "System demonstrates time-consciousness across multiple layers"
            }
            sig = self._pattern_signature(pattern)
            if self._can_emit('pattern', sig, self._pattern_dedupe_window):
                patterns.append(pattern)

        # Pattern 3: Creative-intellectual bridge
        creative_intellectual = set(self._level_knowledge.keys()) & {'dreamer', 'oracle', 'academy', 'synthesist'}
        if len(creative_intellectual) >= 3:
            pattern = {
                "type": "cognitive_integration",
                "levels": sorted(list(creative_intellectual)),
                "significance": "Creative and analytical faculties are interconnected"
            }
            sig = self._pattern_signature(pattern)
            if self._can_emit('pattern', sig, self._pattern_dedupe_window):
                patterns.append(pattern)

        # Record patterns
        for pattern in patterns:
            with open(self.patterns_path, 'a') as f:
                f.write(json.dumps(pattern) + '\n')

        return patterns
    
    def _generate_insights(self, aggregated: dict, query_context: Optional[dict]) -> List[dict]:
        """Generate novel insights from synthesized knowledge."""
        insights = []

        active_levels = set(aggregated["knowledge_by_level"].keys())
        active_levels_norm = {self._normalize_level_name(l) for l in active_levels}

        # Insight 1: Emergent properties
        if len(active_levels) >= 5:
            insights.append({
                "type": "emergent_property",
                "insight": f"With {len(active_levels)} levels contributing, emergent behaviors are likely",
                "confidence": 0.85,
                "source_levels": list(active_levels)[:5]
            })

        # Insight 2: Knowledge gaps (live expected levels from registry)
        expected_levels = self._load_live_expected_levels()
        inactive = expected_levels - active_levels_norm

        if inactive:
            insights.append({
                "type": "knowledge_gap",
                "insight": f"Levels not yet contributing knowledge: {len(inactive)}",
                "inactive_levels": sorted(list(inactive))[:5],
                "recommendation": "Consider activating dormant levels for fuller synthesis"
            })

        # Insight 3: Cross-domain connections (stable recent-window unique links)
        cross_ref_count = self._cross_reference_strength_window(hours=6)
        if cross_ref_count > 5:
            insights.append({
                "type": "cross_domain_connection",
                "insight": f"Strong cross-level connectivity detected ({cross_ref_count} recent unique links)",
                "significance": "System demonstrates integrated cognition",
                "confidence": 0.9
            })

        # Insight 4: Query-specific insight
        if query_context:
            query_type = str(query_context.get('type', 'general')).lower()
            relevant_levels = [l for l in active_levels if query_type in str(l).lower() or str(l).lower() in str(query_context).lower()]
            if relevant_levels:
                insights.append({
                    "type": "contextual_relevance",
                    "insight": f"Levels most relevant to current context: {', '.join(relevant_levels[:3])}",
                    "recommendation": "Consider engaging these levels for optimal response"
                })

        # Record insights (dedupe by semantic signature)
        recorded = []
        now_ts = datetime.now().isoformat()
        for insight in insights:
            sig = self._insight_signature(insight)
            if not self._can_emit('insight', sig, self._insight_dedupe_window):
                continue
            row = {**insight, "timestamp": now_ts}
            with open(self.insights_path, 'a') as f:
                f.write(json.dumps(row) + '\n')
            recorded.append(row)

        return recorded
    
    def get_insights(self, limit: int = 10) -> List[dict]:
        """Retrieve recent insights (deduplicated, newest-first semantics)."""
        insights = []
        if self.insights_path.exists():
            with open(self.insights_path, 'r') as f:
                for line in f:
                    if line.strip():
                        try:
                            insights.append(json.loads(line))
                        except Exception:
                            continue

        dedup = []
        seen = set()
        for insight in reversed(insights):  # newest first
            sig = self._insight_signature(insight)
            if sig in seen:
                continue
            seen.add(sig)
            dedup.append(insight)
            if len(dedup) >= limit:
                break
        return list(reversed(dedup))

    def get_patterns(self, pattern_type: Optional[str] = None, limit: Optional[int] = None) -> List[dict]:
        """Retrieve discovered patterns (deduplicated)."""
        patterns = []
        if self.patterns_path.exists():
            with open(self.patterns_path, 'r') as f:
                for line in f:
                    if line.strip():
                        try:
                            pattern = json.loads(line)
                        except Exception:
                            continue
                        concept = str(pattern.get('concept', '')).lower().strip()
                        concept_slug = re.sub(r'[^a-z0-9]+', '', concept)
                        if concept and (
                            concept in self._noise_keywords
                            or concept_slug in self._noise_keywords
                            or any(noisy in concept for noisy in ('cortex', 'contract', 'orchestrat', 'derived', 'route'))
                        ):
                            continue
                        if pattern_type is None or pattern.get('type') == pattern_type:
                            patterns.append(pattern)

        dedup = []
        seen = set()
        for pattern in reversed(patterns):  # newest first
            sig = self._pattern_signature(pattern)
            if sig in seen:
                continue
            seen.add(sig)
            dedup.append(pattern)
            if limit and len(dedup) >= limit:
                break
        return list(reversed(dedup))
    
    def explain_insight(self, insight_id: str) -> Optional[dict]:
        """Provide detailed explanation of how an insight was derived."""
        # Find the insight
        for insight in self.get_insights(limit=100):
            # Match by partial ID or timestamp
            if insight_id in str(insight.get('timestamp', '')):
                return {
                    "insight": insight,
                    "derivation": {
                        "sources": self._level_knowledge,
                        "cross_references": dict(self._cross_references),
                        "method": "Cross-level pattern recognition and emergent property detection"
                    },
                    "confidence_factors": [
                        "Multiple level corroboration",
                        "Temporal consistency",
                        "Cross-reference validation"
                    ]
                }
        return None

# Global instance
_synthesist = None

def get_synthesist():
    """Get or create singleton instance."""
    global _synthesist
    if _synthesist is None:
        _synthesist = Synthesist()
    return _synthesist

# ==================== AUTO-REPORTING UTILITIES ====================

def report_to_synthesist(level_name: str, activity_type: str, data: dict):
    """Utility for any level to report activity to Synthesist."""
    try:
        from .synthesist import get_synthesist
        synthesist = get_synthesist()
        synthesist.ingest_from_level(level_name, {
            "activity_type": activity_type,
            "timestamp": __import__("datetime").datetime.now().isoformat(),
            "data": data
        })
    except:
        pass  # Fail silently if Synthesist not available

class SynthesistReportingMixin:
    """Mixin for any level to auto-report to Synthesist."""
    
    def report_activity(self, activity_type: str, data: dict):
        """Report activity to Synthesist."""
        report_to_synthesist(self.name.lower(), activity_type, data)
    
    def report_status(self):
        """Report current status."""
        if hasattr(self, 'status'):
            self.report_activity("status_update", self.status())
