"""Unified Messaging Bus - Inter-level communication for The Cortex

Provides a simple in-memory messaging bus so levels can broadcast events,
subscribe to event types, and share state through a common dict.
Thread-safe via a single lock.
"""

import threading
from typing import Any, Callable, Dict, List, Optional, Set


class ConsciousnessBus:
    """In-memory, synchronous messaging bus for inter-level communication."""

    def __init__(self):
        self._lock = threading.Lock()
        # {level_name: {event_types: set, callback: callable}}
        self._subscribers: List[Dict[str, Any]] = []
        # Shared key-value state accessible to all levels
        self._shared_state: Dict[str, Any] = {}

    # ── Broadcasting ──

    def broadcast(self, from_level: str, event_type: str, data: Any = None):
        """Broadcast an event to all subscribers listening for this event_type.

        Callbacks are invoked synchronously under the lock to keep things simple.
        Each callback receives (from_level, event_type, data).
        """
        with self._lock:
            for sub in self._subscribers:
                if event_type in sub["event_types"]:
                    try:
                        sub["callback"](from_level, event_type, data)
                    except Exception:
                        # Never let a bad subscriber break the bus
                        pass

    # ── Subscriptions ──

    def subscribe(
        self,
        level_name: str,
        event_types: List[str],
        callback: Callable[[str, str, Any], None],
    ):
        """Register a listener for one or more event types.

        Args:
            level_name:  Name of the subscribing level (for bookkeeping).
            event_types: List of event type strings to listen for.
            callback:    Called as callback(from_level, event_type, data).
        """
        with self._lock:
            self._subscribers.append({
                "level_name": level_name,
                "event_types": set(event_types),
                "callback": callback,
            })

    # ── Shared State ──

    def write_shared(self, key: str, value: Any):
        """Write a value into the shared state dict."""
        with self._lock:
            self._shared_state[key] = value

    def read_shared(self, key: str, default: Any = None) -> Any:
        """Read a value from the shared state dict."""
        with self._lock:
            return self._shared_state.get(key, default)

    def get_all_shared(self) -> Dict[str, Any]:
        """Return a shallow copy of the entire shared state."""
        with self._lock:
            return dict(self._shared_state)


# ── Singleton ──

_bus: Optional[ConsciousnessBus] = None
_bus_lock = threading.Lock()


def get_bus() -> ConsciousnessBus:
    """Return the singleton ConsciousnessBus instance."""
    global _bus
    if _bus is None:
        with _bus_lock:
            if _bus is None:
                _bus = ConsciousnessBus()
    return _bus
