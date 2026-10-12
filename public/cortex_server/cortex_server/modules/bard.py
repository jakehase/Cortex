"""Level 6: Bard - Text-to-Speech & Voice Synthesis.

The real implementation lives in ``cortex_server.routers.bard`` (Piper over
Wyoming and VibeVoice over HTTP). This module only delegates to it; it never
returns placeholder text pretending speech was produced.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class Bard:
    """Level 6: thin delegate to the Bard router's synthesis functions."""

    def __init__(self):
        self.level = 6
        self.name = "Bard"

    async def speak(self, text: str, voice: Optional[str] = None, backend: Optional[str] = None) -> Dict[str, Any]:
        """Synthesize ``text``; returns the router's SpeakResponse as a dict."""

        from cortex_server.routers.bard import SpeakRequest, text_to_speech

        response = await text_to_speech(SpeakRequest(text=text, voice=voice, backend=backend))
        return response.model_dump() if hasattr(response, "model_dump") else response.dict()

    async def status(self) -> Dict[str, Any]:
        """Measured backend status (protocol handshake based)."""

        from cortex_server.routers.bard import bard_status

        return await bard_status()


_bard: Optional[Bard] = None


def get_bard() -> Bard:
    global _bard
    if _bard is None:
        _bard = Bard()
    return _bard
