"""The Dreamer - Proactive Evolution Module for The Cortex.

Scans logs, identifies gaps, and proposes new skills via the Oracle.
Level 13: The Proactive Dreamer
"""
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional


class Dreamer:
    """Proactive skill evolution agent.
    
    Scans system logs for failures, analyzes gaps with Oracle,
    and proposes new skill extensions.
    """
    
    # Keywords that indicate skill gaps
    GAP_KEYWORDS = ["failed", "error", "unable", "cannot", "not found", "missing", "timeout"]
    
    def __init__(self, 
                 log_path: str = "/app/logs/cortex_event_ledger.jsonl",
                 registry_path: str = "cortex_server/knowledge/evolution/skill_registry.json"):
        self.log_path = Path(log_path)
        if not self.log_path.exists():
            candidates = [
                os.getenv("EVOLUTION_LOG_PATH", "").strip(),
                "/app/logs/cortex_event_ledger.jsonl",
                "/app/logs/oracle_ledger.jsonl",
                "/var/log/cortex.log",
            ]
            for c in candidates:
                if c and Path(c).exists():
                    self.log_path = Path(c)
                    break
        self.registry_path = Path(registry_path)
        self.gaps_found: List[Dict] = []
        self._last_proposal: Optional[Dict] = None
        
    def scan_logs(self, lines: int = 100) -> str:
        """Scan recent log entries for failure patterns.
        
        Args:
            lines: Number of recent log lines to scan
            
        Returns:
            Text summary of gaps found
        """
        if not self.log_path.exists():
            return "No log file found to scan."
        
        try:
            # Read recent log lines
            with open(self.log_path, 'r', encoding='utf-8') as f:
                log_lines = f.readlines()[-lines:]
        except Exception as e:
            return f"Error reading logs: {str(e)}"
        
        # Find lines with gap keywords
        failures = []
        for line_num, line in enumerate(log_lines, 1):
            line_lower = line.lower()
            for keyword in self.GAP_KEYWORDS:
                if keyword in line_lower:
                    # Extract context (20 chars before/after the keyword)
                    idx = line_lower.find(keyword)
                    start = max(0, idx - 40)
                    end = min(len(line), idx + len(keyword) + 40)
                    context = line[start:end].strip()
                    
                    failures.append({
                        'line': line_num,
                        'keyword': keyword,
                        'context': context,
                        'timestamp': datetime.utcnow().isoformat()
                    })
                    break  # Only capture first keyword match per line
        
        if not failures:
            return "No gaps detected in recent logs."
        
        # Store gaps for Oracle analysis
        self.gaps_found = failures
        
        # Build summary
        summary_parts = [f"Detected {len(failures)} potential skill gaps:"]
        for f in failures[:5]:  # Limit to 5 for summary
            summary_parts.append(f"\n- [{f['keyword'].upper()}] {f['context']}")
        
        return "\n".join(summary_parts)
    
    def analyze_with_oracle(self, summary: str) -> str:
        """Query Oracle to understand the root cause of gaps.
        
        Args:
            summary: The gap summary text
            
        Returns:
            Oracle's analysis of what skill is missing
        """
        # For now, local heuristic analysis (Oracle integration placeholder)
        # In full implementation, this would query the local LLM
        
        analysis_rules = {
            'youtube': 'YouTube downloader/transcript extractor skill',
            'download': 'File download manager skill',
            'pdf': 'PDF parsing and extraction skill',
            'video': 'Video processing/transcription skill',
            'audio': 'Audio transcription skill',
            'database': 'Database connector skill',
            'api': 'API integration skill',
            'scrape': 'Web scraping enhancement skill',
            'timeout': 'Async processing optimization skill'
        }
        
        detected_skills = []
        summary_lower = summary.lower()
        
        for keyword, skill in analysis_rules.items():
            if keyword in summary_lower:
                detected_skills.append(skill)
        
        if detected_skills:
            return f"Missing capabilities detected: {', '.join(detected_skills)}"
        
        return "Gap analysis inconclusive. Manual review recommended."
    
    def propose_skill(self, gap_summary: str) -> Dict:
        """Propose a new skill extension based on gap analysis.
        
        Args:
            gap_summary: The analyzed gap description
            
        Returns:
            Skill proposal dictionary
        """
        proposal = {
            'id': f"skill_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            'detected_from': gap_summary[:100],
            'proposed_module': None,
            'status': 'proposed',
            'created_at': datetime.utcnow().isoformat()
        }
        
        # Generate module name from gap
        if 'youtube' in gap_summary.lower():
            proposal['proposed_module'] = 'youtube_handler'
        elif 'pdf' in gap_summary.lower():
            proposal['proposed_module'] = 'pdf_extractor'
        elif 'scrape' in gap_summary.lower() or 'download' in gap_summary.lower():
            proposal['proposed_module'] = 'web_downloader'
        elif 'database' in gap_summary.lower():
            proposal['proposed_module'] = 'db_connector'
        else:
            proposal['proposed_module'] = 'generic_handler'
        
        return proposal
    
    def save_to_registry(self, proposal: Dict) -> bool:
        """Save skill proposal to evolution registry.
        
        Args:
            proposal: Skill proposal dictionary
            
        Returns:
            True if saved successfully
        """
        try:
            # Load existing registry
            if self.registry_path.exists():
                with open(self.registry_path, 'r') as f:
                    registry = json.load(f)
            else:
                registry = []
            
            # Add new proposal
            registry.append(proposal)
            
            # Save back
            with open(self.registry_path, 'w') as f:
                json.dump(registry, f, indent=2)
            
            return True
        except Exception as e:
            print(f"Failed to save to registry: {e}")
            return False
    
    def dream(self) -> str:
        """Full dreaming cycle: scan, analyze, propose, save.
        
        Returns:
            Summary of dreaming results
        """
        # 1. Scan logs
        gap_summary = self.scan_logs()
        
        if "No gaps" in gap_summary:
            self._last_proposal = {
                "status": "no_gaps",
                "message": "No evolution needed. System healthy.",
                "gaps_detected": 0
            }
            return "Dreamer: No evolution needed. System healthy."
        
        # 2. Analyze with Oracle
        analysis = self.analyze_with_oracle(gap_summary)
        
        # 3. Propose skill
        proposal = self.propose_skill(analysis)
        proposal["gaps_detected"] = len(self.gaps_found)
        proposal["gap_summary"] = gap_summary
        
        # Store for API access
        self._last_proposal = proposal
        
        # 4. Save to registry
        saved = self.save_to_registry(proposal)
        proposal["registry_saved"] = saved
        
        # Return summary
        result = f"""🌙 Dreamer Analysis Complete

Gaps Detected: {len(self.gaps_found)}
Analysis: {analysis}
Proposed Skill: {proposal['proposed_module']}
Registry Updated: {'✓' if saved else '✗'}
"""
        return result


# Singleton instance for system-wide dreaming
_dreamer_instance: Optional[Dreamer] = None


def get_dreamer() -> Dreamer:
    """Get or create the Dreamer singleton."""
    global _dreamer_instance
    if _dreamer_instance is None:
        _dreamer_instance = Dreamer()
    return _dreamer_instance
