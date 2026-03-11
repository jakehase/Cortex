"""Level 7: Librarian - Knowledge Graph
Manages knowledge graph storage, retrieval, and semantic relationships.
"""

import json
from pathlib import Path
from datetime import datetime

class Librarian:
    """Level 7: Knowledge Graph Manager."""
    
    def __init__(self):
        self.level = 7
        self.name = "Librarian"
        self.knowledge_path = Path('/app/cortex_server/knowledge/auto_memory.jsonl')
        self.knowledge_path.parent.mkdir(parents=True, exist_ok=True)
    
    def status(self):
        return {"level": self.level, "name": self.name, "status": "active"}
    
    def index(self, entry: dict) -> dict:
        """
        Index a new entry into the Knowledge Graph.
        
        Args:
            entry: Dict containing 'timestamp', 'query', 'subject', 'answer', 
                   'source', 'facts', 'confidence', 'auto_indexed'
        
        Returns:
            Dict with success status and entry_id
        """
        # Generate entry ID
        entry_id = f"kg_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hash(entry['query']) % 10000}"
        
        # Enrich entry with metadata
        enriched_entry = {
            **entry,
            'entry_id': entry_id,
            'indexed_at': datetime.now().isoformat(),
            'version': 1
        }
        
        # Append to knowledge graph
        try:
            with open(self.knowledge_path, 'a') as f:
                f.write(json.dumps(enriched_entry) + '\n')
            return {
                'success': True,
                'entry_id': entry_id,
                'subject': entry.get('subject', 'General'),
                'timestamp': enriched_entry['indexed_at']
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
