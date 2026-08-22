"""The Academy - Self-Optimization Engine for The Cortex.

Level 16: Learn from victories to improve code quality.
Stores successful code patterns and consults them for future generations.
"""
from pathlib import Path
from typing import List, Dict, Optional
import json


class TheAcademy:
    """Self-optimization engine that learns from successful code.
    
    The Academy:
    1. LEARN: Stores successful code in 'golden_code' collection
    2. CONSULT: Retrieves relevant patterns for new tasks
    3. IMPROVE: Code quality increases with each victory
    """
    
    def __init__(self, 
                 knowledge_dir: str = "cortex_server/knowledge/evolution"):
        self.knowledge_dir = Path(knowledge_dir)
        self.knowledge_dir.mkdir(parents=True, exist_ok=True)
        self.golden_code_file = self.knowledge_dir / "golden_code.json"
        
    def learn(self, file_path: str) -> bool:
        """Learn from a successful code file.
        
        Args:
            file_path: Path to the successful module
            
        Returns:
            True if stored successfully
        """
        try:
            path = Path(file_path)
            if not path.exists():
                print(f"[ACADEMY] File not found: {file_path}")
                return False
            
            # Read the code
            with open(path, 'r') as f:
                code_content = f.read()
            
            # Extract module name
            module_name = path.stem
            
            # Load existing golden code
            golden_code = self._load_golden_code()
            
            # Create entry
            entry = {
                'module': module_name,
                'file_path': str(file_path),
                'code': code_content,
                'metadata': {
                    'type': 'code_pattern',
                    'module': module_name,
                    'learned_at': str(Path(file_path).stat().st_mtime) if path.exists() else 'now'
                }
            }
            
            # Check if already exists (update if so)
            existing_idx = None
            for i, item in enumerate(golden_code):
                if item.get('module') == module_name:
                    existing_idx = i
                    break
            
            if existing_idx is not None:
                golden_code[existing_idx] = entry
                print(f"[ACADEMY] Updated existing pattern: {module_name}")
            else:
                golden_code.append(entry)
                print(f"[ACADEMY] Learned new pattern: {module_name}")
            
            # Save back
            self._save_golden_code(golden_code)
            return True
            
        except Exception as e:
            print(f"[ACADEMY] Learn failed: {e}")
            return False
    
    def consult(self, task_description: str, top_n: int = 2) -> List[Dict]:
        """Consult the academy for relevant code patterns.
        
        Args:
            task_description: Description of the task (e.g., "finance handler")
            top_n: Number of patterns to return
            
        Returns:
            List of relevant code pattern dictionaries
        """
        try:
            golden_code = self._load_golden_code()
            
            if not golden_code:
                return []
            
            # Simple keyword matching for relevance
            task_lower = task_description.lower()
            scored_patterns = []
            
            for entry in golden_code:
                module = entry.get('module', '')
                code = entry.get('code', '')
                
                # Calculate relevance score
                score = 0
                
                # Check if keywords in task match module name
                task_words = task_lower.split()
                for word in task_words:
                    if word in module.lower():
                        score += 3
                    if word in code.lower():
                        score += 1
                
                # Check for common patterns
                if 'handler' in task_lower and 'handler' in code.lower():
                    score += 2
                if 'class' in code.lower():
                    score += 1
                
                scored_patterns.append((score, entry))
            
            # Sort by score (descending)
            scored_patterns.sort(key=lambda x: x[0], reverse=True)
            
            # Return top N
            return [entry for score, entry in scored_patterns[:top_n]]
            
        except Exception as e:
            print(f"[ACADEMY] Consult failed: {e}")
            return []
    
    def get_stats(self) -> Dict:
        """Get academy statistics."""
        golden_code = self._load_golden_code()
        return {
            'patterns_learned': len(golden_code),
            'modules': [entry.get('module') for entry in golden_code]
        }
    
    def _load_golden_code(self) -> List[Dict]:
        """Load golden code collection from disk."""
        if self.golden_code_file.exists():
            try:
                with open(self.golden_code_file, 'r') as f:
                    return json.load(f)
            except:
                return []
        return []
    
    def _save_golden_code(self, golden_code: List[Dict]):
        """Save golden code collection to disk."""
        with open(self.golden_code_file, 'w') as f:
            json.dump(golden_code, f, indent=2)


# Singleton instance
_academy_instance = None


def get_academy() -> TheAcademy:
    """Get or create The Academy singleton."""
    global _academy_instance
    if _academy_instance is None:
        _academy_instance = TheAcademy()
    return _academy_instance
