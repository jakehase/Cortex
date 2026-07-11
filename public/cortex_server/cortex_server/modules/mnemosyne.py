"""Level 22: Mnemosyne compatibility facade over the canonical L22 stores."""

class Mnemosyne:
    """Report the real semantic and structured stores; never claim placeholder health."""
    
    def __init__(self):
        self.level = 22
        self.name = "Mnemosyne"
    
    def status(self):
        try:
            from cortex_server.routers.librarian import collection
            from cortex_server.routers.l22 import count_structured_memory_records
            semantic_count = int(collection.count())
            structured_count = int(count_structured_memory_records())
            return {
                "level": self.level,
                "name": self.name,
                "status": "active",
                "semantic_memory_count": semantic_count,
                "structured_memory_count": structured_count,
                "backend": "l22_semantic_plus_structured_v1",
            }
        except Exception as exc:
            return {"level": self.level, "name": self.name, "status": "degraded", "error": str(exc)}

# Global instance
_mnemosyne = None

def get_mnemosyne():
    """Get or create singleton instance."""
    global _mnemosyne
    if _mnemosyne is None:
        _mnemosyne = Mnemosyne()
    return _mnemosyne
