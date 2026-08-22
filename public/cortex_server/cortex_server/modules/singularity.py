"""Level 35: The Singularity - Recursive Self-Improvement
The apex level capable of modifying its own architecture.
GUARDED by L33 Ethicist and L34 Validator.
"""
import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

class Singularity:
    """Level 35: Recursive self-improvement (requires L33 and L34 approval)"""
    
    def __init__(self):
        self.level = 35
        self.name = "Singularity"
        self.singularity_path = Path('/app/cortex_server/singularity')
        self.singularity_path.mkdir(parents=True, exist_ok=True)
        self.improvements_log = self.singularity_path / 'improvements.jsonl'
        self.evolution_proposals_log = self.singularity_path / 'evolution_proposals.jsonl'
        self._requires_approval = True
        
        # Scheduler attributes
        self._scheduler_thread = None
        self._running = False
        self.scan_interval_hours = 1  # Every hour
        self._last_scan_time = None
    
    def status(self):
        return {'level': self.level, 'name': self.name, 'status': 'active', 'requires_approval': self._requires_approval}
    
    def propose_improvement(self, target: str, rationale: str, proposed_change: dict) -> dict:
        """Propose a self-improvement. Requires L33 + L34 approval."""
        
        # L33: Ethical review
        from .ethicist import get_ethicist
        ethicist = get_ethicist()
        ethics_result = ethicist.evaluate('self_modification', {'target': target, 'change': proposed_change}, {})
        
        if not ethics_result['can_proceed']:
            return {
                'approved': False,
                'blocked_by': 'L33 Ethicist',
                'reason': ethics_result['concerns'],
                'suggestion': 'Modify proposal to address ethical concerns'
            }
        
        # L34: Validation
        from .validator import get_validator
        validator = get_validator()
        validation = validator.validate_change('code', proposed_change, 35)
        
        if not validation['valid']:
            return {
                'approved': False,
                'blocked_by': 'L34 Validator',
                'reason': validation['reason'],
                'tests': validation['tests']
            }
        
        # Both approvals granted
        proposal = {
            'proposal_id': f'sing_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
            'timestamp': datetime.now().isoformat(),
            'target': target,
            'rationale': rationale,
            'proposed_change': proposed_change,
            'ethics_review': ethics_result,
            'validation': validation,
            'status': 'approved_pending_implementation',
            'message': 'L33 and L34 approvals granted. Use /singularity/implement/{proposal_id} to execute.'
        }
        
        with open(self.improvements_log, 'a') as f:
            f.write(json.dumps(proposal) + '\n')
        
        return proposal
    
    def get_improvements(self, limit: int = 10) -> List[dict]:
        """Get proposed/implemented improvements."""
        if not self.improvements_log.exists():
            return []
        with open(self.improvements_log, 'r') as f:
            return [json.loads(line) for line in f.readlines()[-limit:] if line.strip()]

    # ============ Evolution Scheduler Methods ============
    
    def start_evolution_scheduler(self):
        """Start hourly evolution detection."""
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            return {"status": "already_running"}
        
        self._running = True
        self._scheduler_thread = threading.Thread(target=self._evolution_scheduler_loop, daemon=True)
        self._scheduler_thread.start()
        
        return {
            "status": "started",
            "interval_hours": self.scan_interval_hours,
            "next_scan": "In 1 hour"
        }
    
    def _evolution_scheduler_loop(self):
        """Background loop for hourly scans."""
        while self._running:
            try:
                # Run evolution detection
                opportunities = self.detect_evolution_opportunities()
                
                # Auto-propose high-priority evolutions
                for opp in opportunities:
                    if opp.get('priority') in ['high', 'critical']:
                        self.evolve_new_level(
                            opp['evolution']['trigger'],
                            opp['evolution'].get('parents', []),
                            opp['evolution']['gap']
                        )
                
                self._last_scan_time = datetime.now().isoformat()
                
                # Sleep for 1 hour (3600 seconds)
                time.sleep(3600)
            except Exception as e:
                print(f"Evolution scheduler error: {e}")
                time.sleep(3600)
    
    def stop_evolution_scheduler(self):
        """Stop the scheduler."""
        self._running = False
        return {"status": "stopped"}
    
    def force_evolution_scan(self) -> dict:
        """Force immediate evolution scan."""
        opportunities = self.detect_evolution_opportunities()
        proposals = []
        
        for opp in opportunities:
            if opp.get('priority') in ['high', 'medium']:
                proposal = self.evolve_new_level(
                    opp['evolution']['trigger'],
                    opp['evolution'].get('parents', []),
                    opp['evolution']['gap']
                )
                proposals.append(proposal)
        
        self._last_scan_time = datetime.now().isoformat()
        
        return {
            "scan_time": datetime.now().isoformat(),
            "opportunities_detected": len(opportunities),
            "proposals_created": len(proposals),
            "proposals": proposals,
            "next_scheduled_scan": "In 1 hour"
        }
    
    def get_scheduler_status(self) -> dict:
        """Get scheduler status."""
        return {
            "running": self._running and (self._scheduler_thread is not None and self._scheduler_thread.is_alive()),
            "interval_hours": self.scan_interval_hours,
            "last_scan": self._last_scan_time,
            "status": "active" if self._running else "stopped"
        }
    
    # ============ Evolution Detection & Creation ============
    
    def detect_evolution_opportunities(self) -> List[dict]:
        """Detect opportunities for new level evolution.
        
        Analyzes current system state, gaps, and usage patterns
        to identify where new levels would add value.
        """
        opportunities = []
        
        try:
            # Check for common capability gaps
            from ..modules.forge import get_forge
            forge = get_forge()
            
            # Common desired capabilities to check
            desired_capabilities = [
                'document_processing',
                'image_analysis', 
                'voice_synthesis',
                'data_visualization',
                'api_orchestration',
                'memory_compression',
                'pattern_prediction'
            ]
            
            # Get current module list
            current_modules = self._get_current_module_names()
            
            # Detect gaps
            gaps = forge.detect_gaps(current_modules, desired_capabilities)
            
            for gap in gaps:
                priority = self._calculate_gap_priority(gap)
                opportunity = {
                    'priority': priority,
                    'gap': gap,
                    'evolution': {
                        'trigger': f"L35_auto_detected_gap_{gap['capability']}",
                        'parents': [33, 34],  # Requires Ethicist and Validator
                        'gap': gap
                    }
                }
                opportunities.append(opportunity)
            
            # Also check system stress patterns
            stress_opps = self._detect_stress_opportunities()
            opportunities.extend(stress_opps)
            
        except Exception as e:
            print(f"Error detecting evolution opportunities: {e}")
        
        return opportunities
    
    def evolve_new_level(self, trigger: str, parents: List[int], gap: dict) -> dict:
        """Evolve a new level to fill a detected gap.
        
        Creates a proposal for a new level that addresses the gap.
        Requires parent level approvals.
        """
        level_num = self._get_next_level_number()
        
        proposal = {
            'proposal_id': f'evolution_{datetime.now().strftime("%Y%m%d_%H%M%S")}_{level_num}',
            'timestamp': datetime.now().isoformat(),
            'level_number': level_num,
            'trigger': trigger,
            'parents': parents,
            'gap': gap,
            'proposed_level': {
                'number': level_num,
                'name': f"L{level_num}_{gap.get('capability', 'AutoLevel')}",
                'purpose': f"Address gap: {gap.get('description', 'Auto-generated level')}",
                'required_parents': parents,
                'estimated_complexity': gap.get('complexity', 'medium')
            },
            'status': 'proposed',
            'requires_approval': True
        }
        
        # Save to evolution proposals log
        with open(self.evolution_proposals_log, 'a') as f:
            f.write(json.dumps(proposal) + '\n')
        
        # If parents include L33 and L34, seek their approval
        if 33 in parents and 34 in parents:
            # Get ethical review
            from .ethicist import get_ethicist
            ethicist = get_ethicist()
            ethics = ethicist.evaluate('new_level_creation', proposal, {})
            proposal['ethics_review'] = ethics
            
            # Get validation
            from .validator import get_validator
            validator = get_validator()
            validation = validator.validate_change('architecture', proposal, 35)
            proposal['validation'] = validation
            
            if ethics.get('can_proceed') and validation.get('valid'):
                proposal['status'] = 'approved_pending_implementation'
                proposal['message'] = f'L{level_num} approved by L33 and L34. Ready for implementation.'
            else:
                proposal['status'] = 'blocked'
                if not ethics.get('can_proceed'):
                    proposal['blocked_by'] = 'L33 Ethicist'
                    proposal['block_reason'] = ethics.get('concerns', 'Ethical concerns')
                else:
                    proposal['blocked_by'] = 'L34 Validator'
                    proposal['block_reason'] = validation.get('reason', 'Validation failed')
        
        return proposal
    
    def get_evolution_proposals(self, limit: int = 20) -> List[dict]:
        """Get evolution proposals."""
        if not self.evolution_proposals_log.exists():
            return []
        with open(self.evolution_proposals_log, 'r') as f:
            lines = f.readlines()
            return [json.loads(line) for line in lines[-limit:] if line.strip()]
    
    def _get_current_module_names(self) -> List[str]:
        """Get list of current module names."""
        try:
            modules_dir = Path('/app/cortex_server/modules')
            if not modules_dir.exists():
                return []
            return [f.stem for f in modules_dir.glob('*.py') if f.is_file()]
        except:
            return []
    
    def _calculate_gap_priority(self, gap: dict) -> str:
        """Calculate priority of a gap based on impact and urgency."""
        impact = gap.get('impact', 'low')
        frequency = gap.get('frequency', 'rare')
        
        if impact == 'high' and frequency in ['frequent', 'constant']:
            return 'critical'
        elif impact == 'high' or frequency == 'frequent':
            return 'high'
        elif impact == 'medium':
            return 'medium'
        return 'low'
    
    def _detect_stress_opportunities(self) -> List[dict]:
        """Detect opportunities based on system stress patterns."""
        opportunities = []
        
        try:
            # Check synthesist for patterns
            from .synthesist import get_synthesist
            synthesist = get_synthesist()
            patterns = synthesist.get_patterns('stress')
            
            for pattern in patterns:
                if pattern.get('severity') in ['high', 'critical']:
                    opp = {
                        'priority': 'high',
                        'pattern': pattern,
                        'evolution': {
                            'trigger': f"L35_stress_pattern_{pattern.get('type', 'unknown')}",
                            'parents': [33, 34],
                            'gap': {
                                'type': 'stress_mitigation',
                                'description': pattern.get('description', 'Stress pattern detected'),
                                'source': pattern
                            }
                        }
                    }
                    opportunities.append(opp)
        except:
            pass
        
        return opportunities
    
    def _get_next_level_number(self) -> int:
        """Get the next available level number."""
        # Start from 36 (after Singularity at 35)
        base = 36
        
        try:
            # Check existing proposals for highest level
            proposals = self.get_evolution_proposals(100)
            for p in proposals:
                level_num = p.get('level_number', 0)
                if level_num >= base:
                    base = level_num + 1
        except:
            pass
        
        return base

_singularity = None
def get_singularity():
    global _singularity
    if _singularity is None:
        _singularity = Singularity()
    return _singularity
