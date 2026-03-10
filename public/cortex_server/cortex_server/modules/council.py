"""The Council - Adversarial Safety Layer for The Cortex.

Level 15: Automated Code Review and Safety Checks.
Reviews skill proposals before materialization to ensure safety.
"""
import requests
from typing import Dict, List


class TheCouncil:
    """Adversarial review board for evolution proposals.
    
    The Council consists of:
    1. The Critic - Identifies risks (Security, Stability, Redundancy)
    2. The Judge - Makes final YES/NO decision
    
    If both approve, the proposal proceeds to materialization.
    """
    
    ORACLE_URL = "http://localhost:8888/oracle/chat"
    
    def __init__(self):
        self.critique_history: List[Dict] = []
    
    def review_proposal(self, proposal: Dict) -> bool:
        """Review a skill proposal through adversarial process.
        
        Args:
            proposal: The skill proposal dictionary
            
        Returns:
            True if approved, False if rejected
        """
        skill_name = proposal.get('proposed_module', 'unknown')
        gap_summary = proposal.get('gap_summary', '')
        detected_from = proposal.get('detected_from', '')
        
        # Build proposal text for review
        proposal_text = f"""Skill Proposal: {skill_name}

Detected From: {detected_from}

Gap Summary: {gap_summary}

This skill would be auto-generated and installed into modules/extensions/.
"""
        
        # Step 1: The Critic - Identify risks
        critique = self._call_critic(proposal_text)
        
        # Step 2: The Judge - Make decision
        decision = self._call_judge(proposal_text, critique)
        
        # Record in history
        review_record = {
            'skill_name': skill_name,
            'critique': critique,
            'decision': decision,
            'approved': decision == "YES"
        }
        self.critique_history.append(review_record)
        
        return decision == "YES"
    
    def _call_critic(self, proposal_text: str) -> str:
        """Call Oracle as Senior Code Reviewer to critique proposal."""
        critic_prompt = f"""You are a Senior Code Reviewer. Critique this feature proposal:

{proposal_text}

List exactly 3 risks:
1. SECURITY: What security concerns exist?
2. STABILITY: What could break or cause failures?
3. REDUNDANCY: Does this duplicate existing functionality?

Be concise. 1-2 sentences per risk."""

        try:
            response = requests.post(
                self.ORACLE_URL,
                json={
                    "prompt": critic_prompt,
                    "system": "You are a cautious, experienced code reviewer focused on safety.",
                    "model": "tinyllama"
                },
                timeout=60
            )
            return response.json().get('response', 'Critique failed')
        except Exception as e:
            return f"Critique error: {str(e)}"
    
    def _call_judge(self, proposal_text: str, critique: str) -> str:
        """Call Oracle as Judge to make final YES/NO decision."""
        judge_prompt = f"""You are the Judge. Review this proposal and critique:

PROPOSAL:
{proposal_text}

CRITIQUE:
{critique}

Given the proposal and the critique above, should we proceed with auto-generating and installing this skill?

Answer with ONLY ONE WORD: YES or NO.

YES = Acceptable risk, proceed with materialization
NO = Too risky, reject proposal"""

        try:
            response = requests.post(
                self.ORACLE_URL,
                json={
                    "prompt": judge_prompt,
                    "system": "You are a conservative judge focused on system safety. Only say YES if the proposal is safe and useful.",
                    "model": "tinyllama"
                },
                timeout=30
            )
            decision = response.json().get('response', 'NO').strip().upper()
            
            # Extract YES/NO from response
            if 'YES' in decision:
                return "YES"
            else:
                return "NO"
        except Exception as e:
            # On error, default to NO (safe)
            return "NO"
    
    def get_last_review(self) -> Dict:
        """Get the most recent review record."""
        if self.critique_history:
            return self.critique_history[-1]
        return {}
    
    def get_review_stats(self) -> Dict:
        """Get statistics on Council decisions."""
        total = len(self.critique_history)
        approved = sum(1 for r in self.critique_history if r.get('approved'))
        rejected = total - approved
        
        return {
            'total_reviewed': total,
            'approved': approved,
            'rejected': rejected,
            'approval_rate': approved / total if total > 0 else 0
        }


# Singleton instance
_council_instance = None


def get_council() -> TheCouncil:
    """Get or create The Council singleton."""
    global _council_instance
    if _council_instance is None:
        _council_instance = TheCouncil()
    return _council_instance
