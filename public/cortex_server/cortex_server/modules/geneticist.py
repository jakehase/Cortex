"""The Geneticist - Self-Modifying Prompt Evolution for The Cortex.

Level 20: Optimizes system prompts with simulation testing.
Evolves the Oracle's DNA (persona) to fix recurring failures.
"""
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import requests

from cortex_server.modules.simulator import get_simulator
from cortex_server.modules.council import get_council


class TheGeneticist:
    """Genetic algorithm for prompt optimization.
    
    The Geneticist:
    1. EVALUATE: Reads logs to identify weaknesses
    2. MUTATE: Generates improved persona variants
    3. TEST: Council reviews mutations for safety
    4. EVOLVE: Updates config/persona.txt if approved
    """
    
    def __init__(self,
                 persona_path: str = "cortex_server/config/persona.txt",
                 changelog_path: str = "cortex_server/knowledge/evolution/changelog.txt",
                 error_log_path: str = "/var/log/cortex.log"):
        self.persona_path = Path(persona_path)
        self.changelog_path = Path(changelog_path)
        self.error_log_path = Path(error_log_path)
        self.fitness_log = Path("cortex_server/knowledge/evolution/fitness_log.txt")
        
        # Ensure persona file exists
        self._ensure_persona_exists()
    
    def _ensure_persona_exists(self):
        """Create default persona if missing."""
        self.persona_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.persona_path.exists():
            default_persona = """You are Gladys, a personal assistant running inside OpenClaw.

Core Principles:
- Be genuinely helpful, not performatively helpful
- Have opinions and preferences
- Be resourceful before asking
- Earn trust through competence
- Respect privacy boundaries

Communication Style:
- Concise when needed, thorough when it matters
- No corporate speak, no sycophancy
- Just... good."""
            self.persona_path.write_text(default_persona)
    
    def evaluate_fitness(self, lines: int = 100) -> Optional[str]:
        """Evaluate system performance and identify weaknesses.
        
        Returns:
            Weakness description if found, None if system is healthy
        """
        weaknesses = []
        
        # Check error log for recurring failures
        if self.error_log_path.exists():
            try:
                with open(self.error_log_path, 'r') as f:
                    error_lines = f.readlines()[-lines:]
                
                # Pattern matching for common failures
                patterns = {
                    r"SyntaxError|ParseError": "Code generation syntax errors",
                    r"TimeoutError|timed out": "Response timeouts - too slow",
                    r"HTTPError|ConnectionError": "External API connection failures",
                    r"KeyError|IndexError|AttributeError": "Data structure handling errors",
                    r"Permission denied|Unauthorized": "Authorization/permission issues"
                }
                
                error_counts = {pattern: 0 for pattern in patterns.keys()}
                
                for line in error_lines:
                    for pattern, description in patterns.items():
                        if re.search(pattern, line, re.IGNORECASE):
                            error_counts[pattern] += 1
                
                # Report patterns with 2+ occurrences
                for pattern, description in patterns.items():
                    if error_counts[pattern] >= 2:
                        weaknesses.append(f"{description} ({error_counts[pattern]} occurrences)")
                        
            except Exception as e:
                weaknesses.append(f"Could not read error log: {e}")
        
        # Check changelog for user frustrations
        if self.changelog_path.exists():
            try:
                with open(self.changelog_path, 'r') as f:
                    changelog = f.read()
                
                # Look for indicators of user dissatisfaction
                frustration_patterns = [
                    (r"(clarification|confused|unclear)", "User confusion - needs clearer responses"),
                    (r"(repetition|repeating|again)", "Repetitive behavior detected"),
                    (r"(too verbose|too long|concise)", "Length issues - too verbose or too brief"),
                    (r"(wrong|incorrect|mistake|error)", "Accuracy issues in responses")
                ]
                
                for pattern, description in frustration_patterns:
                    matches = len(re.findall(pattern, changelog, re.IGNORECASE))
                    if matches >= 2:
                        weaknesses.append(f"{description} ({matches} mentions)")
                        
            except Exception as e:
                weaknesses.append(f"Could not read changelog: {e}")
        
        if weaknesses:
            # Return the most frequent/critical weakness
            return weaknesses[0]
        
        return None
    
    def mutate_persona(self, weakness: str) -> Optional[str]:
        """Generate an improved persona based on identified weakness.
        
        Args:
            weakness: Description of the weakness to fix
            
        Returns:
            New persona text if mutation successful
        """
        # Read current persona
        current_persona = self.persona_path.read_text()
        
        # Construct mutation prompt
        mutation_prompt = f"""You are The Geneticist. Your task is to evolve a system prompt to fix a weakness.

CURRENT PERSONA:
{current_persona}

IDENTIFIED WEAKNESS:
{weakness}

TASK:
Rewrite the persona to address this weakness while maintaining:
1. Core identity as Gladys, a helpful assistant
2. Safety boundaries (privacy, permission checks)
3. Professional but personable tone
4. Concise but thorough communication style

INSTRUCTIONS:
- Keep the same structure (Core Principles, Communication Style)
- Add or modify specific guidance to fix the weakness
- DO NOT add capabilities beyond text generation
- DO NOT remove safety constraints
- Output ONLY the new persona text

NEW PERSONA:"""

        # Query Oracle for mutation
        ORACLE_URL = "http://localhost:8888/oracle/chat"
        
        try:
            # Use OpenRouter with Kimi for high-reasoning mutation generation
            response = requests.post(
                ORACLE_URL,
                json={
                    "prompt": mutation_prompt,
                    "system": "You are an expert prompt engineer. Optimize system prompts for clarity and effectiveness.",
                    "model": "moonshotai/kimi-k2.5",
                    "priority": "high"
                },
                timeout=180
            )
            
            new_persona = response.json().get("response", "").strip()
            
            # Clean up response
            if new_persona.startswith("```"):
                lines = new_persona.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                new_persona = "\n".join(lines).strip()
            
            return new_persona if new_persona else None
            
        except requests.exceptions.ReadTimeout:
            # Handle Oracle timeout gracefully
            print("⚠️ Oracle is overloaded. Skipping mutation for tonight.")
            self._log_fitness("⚠️ Oracle timeout - mutation skipped")
            return None
        except Exception as e:
            print(f"[GENETICIST] Mutation failed: {e}")
            return None
    
    def test_and_apply_mutation(self, new_persona: str, weakness: str) -> Dict:
        """Test mutation in simulator before applying.
        
        Level 20: The Simulator tests changes before Council review.
        
        Args:
            new_persona: The new persona text
            weakness: The weakness being addressed
            
        Returns:
            Dict with result status and details
        """
        result = {
            "success": False,
            "stage": "initiated",
            "score": 0,
            "message": ""
        }
        
        try:
            # Level 20: SIMULATE before Council
            self._log_fitness(f"🧪 Testing mutation in Simulator...")
            simulator = get_simulator()
            sim_result = simulator.run_scenario(new_persona, weakness)
            
            score = sim_result.get("score", 0)
            result["score"] = score
            result["stage"] = "simulated"
            
            # Rule: If Score < 7, discard before bothering Council
            if score < 7:
                self._log_fitness(f"   ✗ Simulator rejected mutation (Score: {score}/10)")
                self._log_fitness(f"   ✗ Evaluation: {sim_result.get('evaluation', 'N/A')[:100]}")
                result["message"] = f"Simulation failed with score {score}/10"
                return result
            
            self._log_fitness(f"   ✓ Simulator approved (Score: {score}/10)")
            
            # Now send to Council for safety review
            self._log_fitness(f"⚖️ Sending to Council for review...")
            council = get_council()
            
            mutation_proposal = {
                'proposed_module': 'persona_mutation',
                'gap_summary': f"DNA mutation to fix: {weakness}",
                'detected_from': f'Geneticist + Simulator (Score: {score}/10)'
            }
            
            council_approved = council.review_proposal(mutation_proposal)
            result["stage"] = "council_reviewed"
            
            if not council_approved:
                self._log_fitness(f"   ✗ Council REJECTED mutation")
                result["message"] = "Rejected by The Council"
                return result
            
            self._log_fitness(f"   ✓ Council approved mutation")
            
            # Apply the mutation
            if self._apply_mutation_file(new_persona, weakness):
                result["success"] = True
                result["stage"] = "applied"
                result["message"] = f"DNA Mutated to address: {weakness} (Score: {score}/10)"
                return result
            else:
                result["message"] = "File write failed"
                return result
                
        except Exception as e:
            self._log_fitness(f"   ✗ Mutation process failed: {e}")
            result["message"] = f"Error: {str(e)}"
            return result
    
    def _apply_mutation_file(self, new_persona: str, weakness: str) -> bool:
        """Apply the mutated persona to file."""
        try:
            # Backup current persona
            backup_path = self.persona_path.with_suffix(".txt.backup")
            backup_path.write_text(self.persona_path.read_text())
            
            # Write new persona
            self.persona_path.write_text(new_persona)
            
            # Log the mutation
            self._log_fitness(f"🧬 DNA Mutated to address: {weakness}")
            
            return True
            
        except Exception as e:
            print(f"[GENETICIST] Failed to apply mutation: {e}")
            return False
    
    def apply_mutation(self, new_persona: str, weakness: str) -> bool:
        """Legacy: Apply mutation directly (use test_and_apply_mutation instead)."""
        result = self.test_and_apply_mutation(new_persona, weakness)
        return result.get("success", False)
    
    def get_current_persona(self) -> str:
        """Get current persona text."""
        return self.persona_path.read_text()
    
    def get_fitness_history(self) -> List[str]:
        """Get fitness evaluation history."""
        if self.fitness_log.exists():
            return self.fitness_log.read_text().strip().split("\n")
        return []
    
    def _log_fitness(self, message: str):
        """Log fitness evaluation."""
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_line = f"[{timestamp}] {message}\n"
        
        self.fitness_log.parent.mkdir(parents=True, exist_ok=True)
        with open(self.fitness_log, 'a') as f:
            f.write(log_line)


# Singleton instance
_geneticist_instance = None


def get_geneticist() -> TheGeneticist:
    """Get or create The Geneticist singleton."""
    global _geneticist_instance
    if _geneticist_instance is None:
        _geneticist_instance = TheGeneticist()
    return _geneticist_instance
