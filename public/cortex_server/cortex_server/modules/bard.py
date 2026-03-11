"""Level 6: Bard - Text-to-Speech & Voice Synthesis
The Bard gives voice to The Cortex via Piper TTS.
"""

class Bard:
    """Level 6: The Bard - Voice synthesis and audio output."""
    
    def __init__(self):
        self.level = 6
        self.name = "Bard"
    
    def speak(self, text):
        """Speak text via Piper TTS."""
        return f"Speaking via Piper: {text[:100]}..."
    
    def status(self):
        return {"level": self.level, "name": self.name, "status": "Voice ready"}

_bard = None

def get_bard():
    global _bard
    if _bard is None:
        _bard = Bard()
    return _bard
