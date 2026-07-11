"""Level 7 compatibility facade over the canonical semantic Librarian router."""

class Librarian:
    """Level 7: Knowledge Graph Manager."""
    
    def __init__(self):
        self.level = 7
        self.name = "Librarian"
    
    def status(self):
        try:
            from cortex_server.routers.librarian import collection
            return {"level": self.level, "name": self.name, "status": "active", "memory_count": int(collection.count()), "backend": "cortex_memory_chroma"}
        except Exception as exc:
            return {"level": self.level, "name": self.name, "status": "degraded", "error": str(exc)}
    
    def index(self, entry: dict) -> dict:
        """
        Index a new entry into the Knowledge Graph.
        
        Args:
            entry: Dict containing 'timestamp', 'query', 'subject', 'answer', 
                   'source', 'facts', 'confidence', 'auto_indexed'
        
        Returns:
            Dict with success status and entry_id
        """
        try:
            from cortex_server.routers.librarian import index_with_novelty
            text = str(entry.get("answer") or entry.get("text") or entry.get("query") or "").strip()
            metadata = {key: value for key, value in entry.items() if key not in {"answer", "text"} and value is not None}
            result = index_with_novelty(text=text, metadata=metadata, novelty_tags=["legacy_l7_facade"], source_scope="l7_compat")
            return {
                'success': True,
                'entry_id': result.get("id"),
                'subject': entry.get('subject', 'General'),
                'status': result.get("status"),
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

# Global instance
_librarian = None

def get_librarian():
    """Get or create singleton instance."""
    global _librarian
    if _librarian is None:
        _librarian = Librarian()
    return _librarian
