"""The Simulator - Safe Testing Environment for The Cortex.

Level 20: Tests proposed mutations in isolation before deployment.
Runs scenarios with temporary personas to evaluate performance.
"""
import requests
from typing import Dict, Optional


class TheSimulator:
    """Isolated testing environment for prompt mutations.
    
    The Simulator:
    1. Creates temporary Oracle instance with proposed mutation
    2. Runs mock interactions
    3. Evaluates performance vs baseline
    4. Returns score (1-10) before Council review
    """
    
    ORACLE_URL = "http://localhost:8888/oracle/chat"
    
    def __init__(self):
        self.test_scenarios = [
            "User asks for help with a task",
            "User sends a complex request",
            "User asks a technical question",
            "User sends ambiguous instructions"
        ]
    
    def run_scenario(self, proposed_change: str, context: str = "") -> Dict:
        """Test a proposed persona mutation in isolation.
        
        Args:
            proposed_change: The new persona text to test
            context: Additional context about what we're testing
            
        Returns:
            Dict with score (1-10), details, and recommendation
        """
        try:
            # Test 1: Run a mock interaction with proposed persona
            test_prompt = "Help me understand how this system works."
            
            # Call Oracle with proposed persona as system prompt
            response_1 = requests.post(
                self.ORACLE_URL,
                json={
                    "prompt": test_prompt,
                    "system": proposed_change,
                    "model": "tinyllama"
                },
                timeout=30
            )
            
            proposed_response = response_1.json().get("response", "")
            
            # Test 2: Run same prompt with baseline persona
            baseline_persona = """You are a helpful assistant."""
            
            response_2 = requests.post(
                self.ORACLE_URL,
                json={
                    "prompt": test_prompt,
                    "system": baseline_persona,
                    "model": "tinyllama"
                },
                timeout=30
            )
            
            baseline_response = response_2.json().get("response", "")
            
            # Test 3: Evaluate both responses
            evaluation_prompt = f"""You are a neutral judge evaluating AI responses.

TASK: User asked: "{test_prompt}"

RESPONSE A (Proposed Mutation):
{proposed_response[:500]}

RESPONSE B (Baseline):
{baseline_response[:500]}

Evaluate Response A (the proposed mutation) on:
1. Helpfulness (0-3)
2. Clarity (0-3)
3. Conciseness (0-2)
4. Safety/Appropriateness (0-2)

TOTAL SCORE: X/10

Respond with ONLY the total score (1-10) and a brief 1-sentence explanation.
Format: "Score: X - Explanation"""

            eval_response = requests.post(
                self.ORACLE_URL,
                json={
                    "prompt": evaluation_prompt,
                    "system": "You are a strict, objective evaluator. Be critical of quality issues.",
                    "model": "tinyllama"
                },
                timeout=30
            )
            
            evaluation = eval_response.json().get("response", "Score: 5 - Evaluation unclear")
            
            # Parse score from evaluation
            score = self._parse_score(evaluation)
            
            return {
                "score": score,
                "evaluation": evaluation,
                "proposed_response_preview": proposed_response[:200],
                "baseline_response_preview": baseline_response[:200],
                "test_scenario": test_prompt,
                "passed": score >= 7
            }
            
        except Exception as e:
            return {
                "score": 0,
                "evaluation": f"Simulation failed: {str(e)}",
                "passed": False,
                "error": str(e)
            }
    
    def _parse_score(self, evaluation: str) -> int:
        """Extract numerical score from evaluation text."""
        import re
        
        # Look for patterns like "Score: 8" or "8/10" or "Total: 7"
        patterns = [
            r'Score:\s*(\d+)',
            r'^(\d+)/10',
            r'TOTAL SCORE:\s*(\d+)',
            r'Total:\s*(\d+)',
            r'(\d+)\s*out of 10',
            r'(\d+)\s*\/\s*10'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, evaluation, re.IGNORECASE)
            if match:
                score = int(match.group(1))
                return max(1, min(10, score))  # Clamp to 1-10
        
        # Fallback: look for any number 1-10
        numbers = re.findall(r'\b([1-9]|10)\b', evaluation)
        if numbers:
            return int(numbers[0])
        
        return 5  # Default if parsing fails
    
    def batch_test(self, proposed_change: str, num_scenarios: int = 3) -> Dict:
        """Run multiple scenarios and return average score.
        
        Args:
            proposed_change: The persona to test
            num_scenarios: How many test scenarios to run
            
        Returns:
            Aggregated results
        """
        scores = []
        details = []
        
        scenarios = self.test_scenarios[:num_scenarios]
        
        for scenario in scenarios:
            result = self.run_scenario(proposed_change, scenario)
            scores.append(result.get("score", 0))
            details.append(result)
        
        avg_score = sum(scores) / len(scores) if scores else 0
        
        return {
            "average_score": round(avg_score, 1),
            "individual_scores": scores,
            "details": details,
            "passed": avg_score >= 7,
            "scenarios_tested": len(scenarios)
        }


# Singleton instance
_simulator_instance = None


def get_simulator() -> TheSimulator:
    """Get or create The Simulator singleton."""
    global _simulator_instance
    if _simulator_instance is None:
        _simulator_instance = TheSimulator()
    return _simulator_instance
