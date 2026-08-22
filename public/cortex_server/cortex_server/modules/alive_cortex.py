from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


STATE_PATH = Path("/app/config/alive_cortex_state.json")


def _now() -> float:
    return time.time()


def _iso(ts: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ts or _now()))


def classify_prompt(prompt: str) -> Dict[str, Any]:
    t = (prompt or "").lower()
    strategic = any(k in t for k in ["strategy", "roadmap", "architecture", "migration", "tradeoff", "priorit"])
    ethical = any(k in t for k in ["ethic", "privacy", "consent", "harm", "bias", "safe", "security risk"])
    uncertain = any(k in t for k in ["not sure", "uncertain", "maybe", "likely", "estimate", "guess", "could be"])

    extra_levels = []
    if any(k in t for k in ["code", "implement", "bug", "fix", "refactor", "test", "patch"]):
        extra_levels += [9, 34]
    if any(k in t for k in ["search", "research", "source", "fact", "reference"]):
        extra_levels += [2, 7]
    if strategic:
        extra_levels += [15]
    if ethical:
        extra_levels += [33]
    if uncertain:
        extra_levels += [34]

    return {
        "strategic": strategic,
        "ethical": ethical,
        "uncertain": uncertain,
        "task_levels": sorted(set(extra_levels)),
    }


@dataclass
class CircuitBreaker:
    threshold: int = 3
    base_backoff_sec: int = 5
    max_backoff_sec: int = 120
    failures: int = 0
    open_until: float = 0.0

    def allow(self) -> bool:
        return _now() >= self.open_until

    def on_success(self) -> None:
        self.failures = 0
        self.open_until = 0.0

    def on_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            backoff = min(self.max_backoff_sec, self.base_backoff_sec * (2 ** (self.failures - self.threshold)))
            self.open_until = _now() + backoff


@dataclass
class AliveState:
    mood: str = "focused"
    focus: Optional[str] = None
    curiosity: List[str] = field(default_factory=list)
    unresolved_threads: List[str] = field(default_factory=list)
    prompt_count: int = 0
    last_tick_at: str = field(default_factory=_iso)
    heartbeat_exemptions: int = 0


class AliveCortexMode:
    CORE_LEVELS = [37, 5, 21, 22, 26]

    def __init__(self, config_provider: Callable[[], Dict[str, Any]]):
        self._config_provider = config_provider
        self._state = AliveState()
        self._lock = threading.Lock()
        self._loop_started = False
        self._breaker = CircuitBreaker()
        self._load_state()

    def _load_state(self) -> None:
        try:
            if STATE_PATH.exists():
                data = json.loads(STATE_PATH.read_text())
                self._state = AliveState(**{**self._state.__dict__, **data})
        except Exception:
            pass

    def _save_state(self) -> None:
        try:
            STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            STATE_PATH.write_text(json.dumps(self._state.__dict__, indent=2))
        except Exception:
            pass

    def start_loop_if_needed(self) -> None:
        if self._loop_started:
            return
        self._loop_started = True

        def _loop():
            while True:
                try:
                    with self._lock:
                        self._state.last_tick_at = _iso()
                        # gentle decay prevents stale-state storms
                        if len(self._state.curiosity) > 8:
                            self._state.curiosity = self._state.curiosity[-8:]
                        if len(self._state.unresolved_threads) > 20:
                            self._state.unresolved_threads = self._state.unresolved_threads[-20:]
                        self._save_state()
                except Exception:
                    pass
                time.sleep(20)

        threading.Thread(target=_loop, daemon=True, name="alive-cortex-loop").start()

    def enabled(self) -> bool:
        return bool(self._config_provider().get("alive_cortex_mode", {}).get("enabled", False))

    def should_hide_hud_signature(self, prompt: str) -> bool:
        t = (prompt or "").lower()
        return "heartbeat_ok" in t or "no_reply" in t

    def hud_signature(self, levels: List[int], mood: str) -> str:
        lv = ",".join(f"L{x}" for x in sorted(set(levels)))
        return f"[ALIVE HUD | {lv} | mood={mood}]"

    def _safe_call(self, fn: Callable[[], Any], fallback: Any = None) -> Any:
        if not self._breaker.allow():
            return fallback
        try:
            out = fn()
            self._breaker.on_success()
            return out
        except Exception:
            self._breaker.on_failure()
            return fallback

    def orchestrate(
        self,
        prompt: str,
        call_oracle: Callable[[str], str],
        call_council: Callable[[str], Optional[Dict[str, Any]]],
        call_ethicist: Callable[[str], Optional[Dict[str, Any]]],
        call_validator: Callable[[Dict[str, Any]], Optional[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        self.start_loop_if_needed()
        cls = classify_prompt(prompt)
        active_levels = sorted(set(self.CORE_LEVELS + cls["task_levels"]))

        with self._lock:
            self._state.prompt_count += 1
            self._state.focus = prompt[:140]
            if cls["uncertain"]:
                self._state.unresolved_threads.append(prompt[:200])
            if "why" in prompt.lower() or "how" in prompt.lower():
                self._state.curiosity.append(prompt[:200])
            unresolved = len(self._state.unresolved_threads)
            self._state.mood = "concerned" if unresolved > 5 else ("curious" if len(self._state.curiosity) > 0 else "focused")
            self._save_state()

        outputs: Dict[str, Any] = {}
        outputs["l5_oracle"] = self._safe_call(lambda: call_oracle(prompt), fallback="")

        if cls["strategic"] or cls["ethical"] or cls["uncertain"]:
            active_levels += [15, 33, 34]
            outputs["l15_council"] = self._safe_call(lambda: call_council(prompt), fallback=None)
            if cls["ethical"]:
                outputs["l33_ethicist"] = self._safe_call(lambda: call_ethicist(prompt), fallback=None)
            outputs["l34_validator"] = self._safe_call(lambda: call_validator({"success": True, "data": outputs}), fallback=None)

        # L26 conductor-first composition
        composition_prompt = (
            "You are L26 Orchestrator. Compose final response from multi-level outputs. "
            "Prioritize correctness, clear actions, and safety.\n\n"
            f"User prompt:\n{prompt}\n\n"
            f"Outputs:\n{json.dumps(outputs, default=str)[:6000]}\n\n"
            "Return concise final answer only."
        )
        final_response = self._safe_call(lambda: call_oracle(composition_prompt), fallback=outputs.get("l5_oracle", ""))

        active_levels = sorted(set(active_levels))
        return {
            "response": final_response or outputs.get("l5_oracle", ""),
            "active_levels": active_levels,
            "state": self._state.__dict__.copy(),
            "classifiers": cls,
            "outputs": outputs,
        }


_alive = None


def get_alive_mode(config_provider: Callable[[], Dict[str, Any]]) -> AliveCortexMode:
    global _alive
    if _alive is None:
        _alive = AliveCortexMode(config_provider=config_provider)
    return _alive
