"""Legacy persona "DNA" Geneticist — proposal-only, never writes the persona.

The original module rewrote ``cortex_server/config/persona.txt`` (the assistant
persona) after an unauthenticated Oracle call, a legacy simulator score and a
substring ``'YES' in decision`` Council check, and even created the persona file
as a side effect of construction.  The assistant persona must never be changed
by an automated path, so this module now:

* reads the persona if it exists, and never creates, backs up or overwrites it;
* generates a *proposed* persona text through ``level_model`` (authenticated,
  receipt-validated) when asked, returning it for a human to review and apply
  by hand;
* refuses every apply call (``_apply_mutation_file`` / ``apply_mutation``) with
  ``persona_write_forbidden``;
* still offers the read-only log-pattern weakness scan (labelled as regex
  counting).
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

PERSONA_WRITE_FORBIDDEN = "persona_write_forbidden"


class PersonaWriteForbidden(PermissionError):
    """Automated persona writes are not allowed."""


class TheGeneticist:
    """Read-only persona inspector + model-backed persona *proposals*."""

    def __init__(self,
                 persona_path: str = "cortex_server/config/persona.txt",
                 changelog_path: str = "cortex_server/knowledge/evolution/changelog.txt",
                 error_log_path: str = "/var/log/cortex.log"):
        self.persona_path = Path(persona_path)
        self.changelog_path = Path(changelog_path)
        self.error_log_path = Path(error_log_path)
        self.fitness_log = Path("cortex_server/knowledge/evolution/fitness_log.txt")
        self._history: List[str] = []

    def evaluate_fitness(self, lines: int = 100) -> Optional[str]:
        """Regex-count recurring error patterns in the log (read-only heuristic)."""
        weaknesses = []
        if self.error_log_path.exists():
            try:
                with open(self.error_log_path, 'r', errors="replace") as f:
                    error_lines = f.readlines()[-max(1, min(int(lines), 5000)):]
                patterns = {
                    r"SyntaxError|ParseError": "Code generation syntax errors",
                    r"TimeoutError|timed out": "Response timeouts - too slow",
                    r"HTTPError|ConnectionError": "External API connection failures",
                    r"KeyError|IndexError|AttributeError": "Data structure handling errors",
                    r"Permission denied|Unauthorized": "Authorization/permission issues",
                }
                counts = {pattern: 0 for pattern in patterns}
                for line in error_lines:
                    for pattern in patterns:
                        if re.search(pattern, line, re.IGNORECASE):
                            counts[pattern] += 1
                for pattern, description in patterns.items():
                    if counts[pattern] >= 2:
                        weaknesses.append(f"{description} ({counts[pattern]} occurrences, regex count)")
            except OSError as exc:
                weaknesses.append(f"Could not read error log: {type(exc).__name__}")
        return weaknesses[0] if weaknesses else None

    def mutate_persona(self, weakness: str, *, principal_scope_key: str = "admin:level.geneticist") -> Optional[str]:
        """Return a model-proposed persona text, or None. Never writes anything."""
        from cortex_server.modules import level_model

        current = self.get_current_persona()
        if not current.strip():
            return None
        result = level_model.level_model_call_sync(
            level=19,
            name="geneticist",
            system="You are an expert prompt engineer. Output ONLY the revised persona text.",
            prompt=(
                "Revise this assistant persona to address the weakness, keeping identity, safety boundaries, "
                "privacy and permission checks intact and adding no new capabilities.\n\n"
                f"WEAKNESS:\n{str(weakness)[:1000]}\n\nCURRENT PERSONA:\n{current[:12000]}"
            ),
            principal_scope_key=principal_scope_key,
        )
        if not result.get("ok"):
            self._note(f"persona proposal unavailable: {result.get('status')}")
            return None
        self._note("persona proposal generated (not applied)")
        return str(result.get("text") or "").strip() or None

    def test_and_apply_mutation(self, new_persona: str, weakness: str) -> Dict:
        """Proposal only: the persona is never written by an automated path."""
        return {
            "success": False,
            "stage": "proposal_only",
            "error": PERSONA_WRITE_FORBIDDEN,
            "message": "Automated persona writes are disabled; review the proposal and apply it manually.",
            "weakness": str(weakness)[:300],
            "proposal_preview": str(new_persona or "")[:600],
        }

    def _apply_mutation_file(self, new_persona: str, weakness: str) -> bool:
        """Refuse: the assistant persona file is never overwritten automatically."""
        del new_persona, weakness
        self._note("refused automated persona write")
        return False

    def apply_mutation(self, new_persona: str, weakness: str) -> bool:
        return self._apply_mutation_file(new_persona, weakness)

    def get_current_persona(self) -> str:
        try:
            return self.persona_path.read_text() if self.persona_path.is_file() else ""
        except OSError:
            return ""

    def get_fitness_history(self) -> List[str]:
        history = list(self._history)
        try:
            if self.fitness_log.is_file():
                history = self.fitness_log.read_text().strip().split("\n") + history
        except OSError:
            pass
        return history

    def _note(self, message: str) -> None:
        self._history.append(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}")
        del self._history[:-100]

    # Backward-compatible name; in-memory only (no file writes).
    _log_fitness = _note


_geneticist_instance = None


def get_geneticist() -> TheGeneticist:
    """Get or create The Geneticist singleton (no filesystem side effects)."""
    global _geneticist_instance
    if _geneticist_instance is None:
        _geneticist_instance = TheGeneticist()
    return _geneticist_instance
