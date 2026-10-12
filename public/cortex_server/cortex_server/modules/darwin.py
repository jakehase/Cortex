"""Level 12 (Darwin half): no in-process self-healing implementation exists.

The only Darwin surface is ``routers/darwin.py`` (proposal-only code review,
unmounted in safe mode).  This module reports that truthfully instead of a
"placeholder" status, and points swarm work at :mod:`hive_swarm`.
"""


class Darwin:
    """Truthful stand-in: reports absence instead of pretending to run."""

    def __init__(self):
        self.level = 12
        self.name = "Darwin"

    def status(self):
        return {
            "level": self.level,
            "name": self.name,
            "status": "not_implemented",
            "note": "no autonomous self-healing runs in process; /darwin/evolve is a proposal-only router "
                    "that is unmounted in safe mode. Swarm execution lives in cortex_server.modules.hive_swarm.",
        }


# Global instance
_darwin = None


def get_darwin():
    """Get or create singleton instance."""
    global _darwin
    if _darwin is None:
        _darwin = Darwin()
    return _darwin
