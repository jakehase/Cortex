"""
Python File Parser - Extract functions, classes, imports, and dependencies.
"""

import ast
import hashlib
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Set
from pathlib import Path


@dataclass
class ParseError:
    """Error during parsing."""
    filepath: str
    message: str
    lineno: Optional[int] = None
    col: Optional[int] = None


@dataclass 
class ParseResult:
    """Result of parsing a Python file."""
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    edges: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[ParseError] = field(default_factory=list)
    
    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


@dataclass
class ParserConfig:
    """Configuration for Python parser."""
    exclude_patterns: List[str] = field(default_factory=lambda: [
        "**/venv/**", "**/.venv/**", "**/__pycache__/**", "**/.git/**"
    ])
    max_depth: int = 10
    max_file_bytes: Optional[int] = 2_000_000
    extract_docstrings: bool = True
    extract_type_annotations: bool = True


class PythonParser(ast.NodeVisitor):
    """Parse Python files and extract knowledge graph entities."""
    
    def __init__(self, config: Optional[ParserConfig] = None):
        self.config = config or ParserConfig()
        self.current_file: str = ""
        self.current_function: Optional[str] = None
        self.current_class: Optional[str] = None
        self.module_name: str = ""
        self.nodes: List[Dict[str, Any]] = []
        self.edges: List[Dict[str, Any]] = []
        self._node_ids: Set[str] = set()
    
    def _make_id(self, *parts) -> str:
        """Create a unique node ID."""
        raw_id = ":".join(str(p) for p in parts)
        # Hash if too long
        if len(raw_id) > 200:
            hash_part = hashlib.md5(raw_id.encode()).hexdigest()[:8]
            raw_id = raw_id[:190] + ":" + hash_part
        return raw_id
    
    def _add_node(self, node: Dict[str, Any]) -> str:
        """Add a node if it doesn't exist."""
        node_id = node.get("id")
        if node_id and node_id not in self._node_ids:
            self.nodes.append(node)
            self._node_ids.add(node_id)
        return node_id
    
    def _add_edge(self, edge: Dict[str, Any]) -> None:
        """Add an edge."""
        self.edges.append(edge)
    
    def parse_file(self, filepath: str) -> ParseResult:
        """Parse a Python file and return extracted entities."""
        result = ParseResult()
        self.current_file = filepath
        self.module_name = Path(filepath).stem
        self.nodes = []
        self.edges = []
        self._node_ids = set()
        
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                source = f.read()
        except Exception as e:
            result.errors.append(ParseError(filepath, f"IO error: {e}"))
            return result
        
        # Check file size
        if self.config.max_file_bytes and len(source) > self.config.max_file_bytes:
            result.errors.append(ParseError(filepath, f"File too large: {len(source)} bytes"))
            return result
        
        try:
            tree = ast.parse(source, filename=filepath)
        except SyntaxError as e:
            result.errors.append(ParseError(filepath, e.msg, e.lineno, e.offset))
            return result
        
        # Add parent references for scope analysis
        self._annotate_parents(tree)
        
        # Create module node
        module_id = self._make_id("module", filepath)
        self._add_node({
            "id": module_id,
            "type": "Module",
            "name": self.module_name,
            "uri": filepath,
            "language": "python",
            "metadata": {
                "file_path": filepath,
                "lines": len(source.splitlines()),
            }
        })
        
        # Visit all nodes
        self.visit(tree)
        
        result.nodes = self.nodes
        result.edges = self.edges
        return result
    
    def _annotate_parents(self, tree: ast.AST) -> None:
        """Add parent references to all nodes."""
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                setattr(child, "parent", node)
    
    def _is_module_level(self, node: ast.AST) -> bool:
        """Check if a node is at module level."""
        parent = getattr(node, "parent", None)
        return isinstance(parent, ast.Module)
    
    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        """Visit function definitions."""
        self._handle_function(node, is_async=False)
    
    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        """Visit async function definitions."""
        self._handle_function(node, is_async=True)
    
    def _handle_function(self, node: ast.FunctionDef, is_async: bool) -> None:
        """Handle both sync and async functions."""
        # Build qualified name
        if self.current_class:
            qualname = f"{self.current_class}.{node.name}"
        else:
            qualname = node.name
        
        # Extract arguments
        args = []
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
            arg_info = {"name": arg.arg}
            if arg.annotation and self.config.extract_type_annotations:
                try:
                    arg_info["type"] = ast.unparse(arg.annotation)
                except:
                    pass
            args.append(arg_info)
        
        if node.args.vararg:
            args.append({"name": f"*{node.args.vararg.arg}"})
        if node.args.kwarg:
            args.append({"name": f"**{node.args.kwarg.arg}"})
        
        # Extract return type
        return_type = None
        if node.returns and self.config.extract_type_annotations:
            try:
                return_type = ast.unparse(node.returns)
            except:
                pass
        
        # Extract docstring
        docstring = None
        if self.config.extract_docstrings:
            docstring = ast.get_docstring(node)
        
        # Extract decorators
        decorators = []
        for dec in node.decorator_list:
            try:
                decorators.append(ast.unparse(dec))
            except:
                pass
        
        func_id = self._make_id("function", self.current_file, qualname)
        self._add_node({
            "id": func_id,
            "type": "Function",
            "name": node.name,
            "uri": f"{self.current_file}#{qualname}",
            "language": "python",
            "metadata": {
                "qualified_name": qualname,
                "args": args,
                "return_type": return_type,
                "docstring": docstring,
                "decorators": decorators,
                "is_async": is_async,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", None),
                "is_method": self.current_class is not None,
            }
        })
        
        # Add CONTAINS edge from class or module
        if self.current_class:
            parent_id = self._make_id("class", self.current_file, self.current_class)
        else:
            parent_id = self._make_id("module", self.current_file)
        
        self._add_edge({
            "id": self._make_id("contains", parent_id, func_id),
            "type": "CONTAINS",
            "source_id": parent_id,
            "target_id": func_id,
            "metadata": {"line": node.lineno}
        })
        
        # Track current function for call detection
        prev_function = self.current_function
        self.current_function = qualname
        
        # Visit children
        self.generic_visit(node)
        
        # Restore
        self.current_function = prev_function
    
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        """Visit class definitions."""
        # Extract base classes
        bases = []
        for base in node.bases:
            try:
                bases.append(ast.unparse(base))
            except:
                pass
        
        # Extract docstring
        docstring = None
        if self.config.extract_docstrings:
            docstring = ast.get_docstring(node)
        
        class_id = self._make_id("class", self.current_file, node.name)
        
        # Store previous class for nested classes
        prev_class = self.current_class
        self.current_class = node.name
        
        self._add_node({
            "id": class_id,
            "type": "Class",
            "name": node.name,
            "uri": f"{self.current_file}#{node.name}",
            "language": "python",
            "metadata": {
                "bases": bases,
                "docstring": docstring,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", None),
            }
        })
        
        # Add CONTAINS edge from module
        module_id = self._make_id("module", self.current_file)
        self._add_edge({
            "id": self._make_id("contains", module_id, class_id),
            "type": "CONTAINS",
            "source_id": module_id,
            "target_id": class_id,
            "metadata": {"line": node.lineno}
        })
        
        # Visit children (methods)
        self.generic_visit(node)
        
        # Restore
        self.current_class = prev_class
    
    def visit_Import(self, node: ast.Import) -> None:
        """Visit import statements."""
        module_id = self._make_id("module", self.current_file)
        
        for alias in node.names:
            import_id = self._make_id("import", self.current_file, alias.name, node.lineno)
            self._add_edge({
                "id": import_id,
                "type": "IMPORTS",
                "source_id": module_id,
                "target_id": alias.name,
                "metadata": {
                    "line": node.lineno,
                    "asname": alias.asname,
                    "is_from": False,
                }
            })
        
        self.generic_visit(node)
    
    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """Visit from ... import statements."""
        module_id = self._make_id("module", self.current_file)
        module = ("." * node.level) + (node.module or "")
        
        for alias in node.names:
            target = f"{module}:{alias.name}"
            import_id = self._make_id("import", self.current_file, target, node.lineno)
            self._add_edge({
                "id": import_id,
                "type": "IMPORTS",
                "source_id": module_id,
                "target_id": target,
                "metadata": {
                    "line": node.lineno,
                    "module": module,
                    "name": alias.name,
                    "asname": alias.asname,
                    "is_from": True,
                }
            })
        
        self.generic_visit(node)
    
    def visit_Assign(self, node: ast.Assign) -> None:
        """Visit assignments at module level."""
        if self._is_module_level(node):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    name = target.id
                    kind = "Constant" if name.isupper() else "Variable"
                    
                    # Try to extract value
                    value = None
                    try:
                        value = ast.unparse(node.value)[:100]  # Limit length
                    except:
                        pass
                    
                    var_id = self._make_id(kind.lower(), self.current_file, name)
                    self._add_node({
                        "id": var_id,
                        "type": kind,
                        "name": name,
                        "uri": f"{self.current_file}#{name}",
                        "language": "python",
                        "metadata": {
                            "value": value,
                            "line": node.lineno,
                        }
                    })
                    
                    # Add CONTAINS edge from module
                    module_id = self._make_id("module", self.current_file)
                    self._add_edge({
                        "id": self._make_id("contains", module_id, var_id),
                        "type": "CONTAINS",
                        "source_id": module_id,
                        "target_id": var_id,
                        "metadata": {"line": node.lineno}
                    })
        
        self.generic_visit(node)
    
    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        """Visit annotated assignments at module level."""
        if self._is_module_level(node) and isinstance(node.target, ast.Name):
            name = node.target.id
            kind = "Constant" if name.isupper() else "Variable"
            
            annotation = None
            if self.config.extract_type_annotations and node.annotation:
                try:
                    annotation = ast.unparse(node.annotation)
                except:
                    pass
            
            value = None
            if node.value:
                try:
                    value = ast.unparse(node.value)[:100]
                except:
                    pass
            
            var_id = self._make_id(kind.lower(), self.current_file, name)
            self._add_node({
                "id": var_id,
                "type": kind,
                "name": name,
                "uri": f"{self.current_file}#{name}",
                "language": "python",
                "metadata": {
                    "annotation": annotation,
                    "value": value,
                    "line": node.lineno,
                }
            })
            
            module_id = self._make_id("module", self.current_file)
            self._add_edge({
                "id": self._make_id("contains", module_id, var_id),
                "type": "CONTAINS",
                "source_id": module_id,
                "target_id": var_id,
                "metadata": {"line": node.lineno}
            })
        
        self.generic_visit(node)
    
    def visit_Call(self, node: ast.Call) -> None:
        """Visit function calls to detect CALLS edges."""
        if self.current_function:
            callee = self._get_call_name(node.func)
            if callee:
                caller_id = self._make_id("function", self.current_file, self.current_function)
                call_id = self._make_id("call", caller_id, callee, node.lineno)
                self._add_edge({
                    "id": call_id,
                    "type": "CALLS",
                    "source_id": caller_id,
                    "target_id": callee,
                    "metadata": {"line": node.lineno}
                })
        
        self.generic_visit(node)
    
    def _get_call_name(self, func: ast.expr) -> Optional[str]:
        """Extract the name of a called function."""
        if isinstance(func, ast.Name):
            return func.id
        elif isinstance(func, ast.Attribute):
            try:
                return ast.unparse(func)
            except:
                return None
        return None