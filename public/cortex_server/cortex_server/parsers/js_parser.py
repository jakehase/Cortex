"""
JavaScript/TypeScript Parser - Extract functions, classes, imports, and exports.
Uses tree-sitter for parsing (no Node.js dependency).
"""

import json
import subprocess
import tempfile
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from pathlib import Path


@dataclass
class JSParseError:
    """Error during parsing."""
    filepath: str
    message: str
    lineno: Optional[int] = None


@dataclass
class JSParseResult:
    """Result of parsing a JS/TS file."""
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    edges: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[JSParseError] = field(default_factory=list)
    
    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


@dataclass
class JSParserConfig:
    """Configuration for JS/TS parser."""
    extract_jsdoc: bool = True
    max_file_bytes: Optional[int] = 2_000_000
    use_tree_sitter: bool = True  # If False, use Node.js/babel parser


class JSParser:
    """Parse JavaScript/TypeScript files and extract knowledge graph entities."""
    
    # Tree-sitter query patterns
    FUNCTION_QUERY = """
    [
      (function_declaration name: (identifier) @func.name)
      (function_declaration parameters: (formal_parameters) @func.params)
      (function_declaration body: (statement_block) @func.body)
      
      (arrow_function) @arrow.func
      
      (method_definition name: (property_identifier) @method.name)
      
      (class_declaration name: (type_identifier) @class.name)
      (class_declaration superclass: (extends_clause (identifier) @class.super))
      
      (import_statement source: (string) @import.source)
      (import_clause (identifier) @import.name)
      
      (export_statement (function_declaration name: (identifier) @export.func))
      (export_statement (class_declaration name: (type_identifier) @export.class))
      
      (call_expression function: (identifier) @call.name)
      (call_expression function: (member_expression) @call.member)
    ]
    """
    
    def __init__(self, config: Optional[JSParserConfig] = None):
        self.config = config or JSParserConfig()
        self._tree_sitter_available = False
        self._parser = None
        self._js_language = None
        self._ts_language = None
        
        if self.config.use_tree_sitter:
            try:
                from tree_sitter import Language, Parser
                
                # Try new API first (tree-sitter 0.22+)
                try:
                    from tree_sitter_javascript import language as js_lang
                    from tree_sitter_typescript import language as ts_lang
                    self._js_language = Language(js_lang())
                    self._ts_language = Language(ts_lang())
                except (ImportError, TypeError):
                    # Fall back to older API
                    try:
                        import tree_sitter_javascript as ts_javascript
                        import tree_sitter_typescript as ts_typescript
                        self._js_language = Language(ts_javascript.library_path, "javascript")
                        self._ts_language = Language(ts_typescript.library_path, "typescript")
                    except:
                        pass
                
                if self._js_language:
                    self._parser = Parser()
                    self._tree_sitter_available = True
            except ImportError:
                pass
    
    def parse_file(self, filepath: str) -> JSParseResult:
        """Parse a JS/TS file and return extracted entities."""
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                source = f.read()
        except Exception as e:
            result = JSParseResult()
            result.errors.append(JSParseError(filepath, f"IO error: {e}"))
            return result
        
        ext = Path(filepath).suffix.lower()
        is_typescript = ext in (".ts", ".tsx")
        
        if self._tree_sitter_available and self.config.use_tree_sitter:
            return self._parse_with_tree_sitter(source, filepath, is_typescript)
        else:
            return self._parse_with_node(source, filepath, is_typescript)
    
    def _parse_with_tree_sitter(self, source: str, filepath: str, is_typescript: bool) -> JSParseResult:
        """Parse using tree-sitter."""
        result = JSParseResult()
        
        try:
            from tree_sitter import Language
            
            # Set language based on file type
            if is_typescript:
                self._parser.set_language(self._ts_language)
            else:
                self._parser.set_language(self._js_language)
            
            tree = self._parser.parse(source.encode())
            root = tree.root_node
            
            module_id = f"module:{filepath}"
            result.nodes.append({
                "id": module_id,
                "type": "Module",
                "name": Path(filepath).stem,
                "uri": filepath,
                "language": "typescript" if is_typescript else "javascript",
                "metadata": {
                    "file_path": filepath,
                    "is_typescript": is_typescript,
                }
            })
            
            self._extract_tree_sitter_nodes(root, result, filepath, module_id, source)
            
        except Exception as e:
            result.errors.append(JSParseError(filepath, f"Parse error: {e}"))
        
        return result
    
    def _extract_tree_sitter_nodes(self, node, result: JSParseResult, filepath: str, module_id: str, source: str):
        """Recursively extract nodes from tree-sitter AST."""
        cursor = node.walk()
        
        current_function = None
        current_class = None
        
        def visit(n, depth=0):
            nonlocal current_function, current_class
            
            node_type = n.type
            
            # Function declaration
            if node_type in ("function_declaration", "function"):
                name_node = n.child_by_field_name("name")
                name = source[name_node.start_byte:name_node.end_byte] if name_node else "anonymous"
                
                func_id = f"function:{filepath}:{name}"
                params_node = n.child_by_field_name("parameters")
                params = []
                if params_node:
                    for param in params_node.children:
                        if param.type == "identifier":
                            params.append(source[param.start_byte:param.end_byte])
                
                is_async = any(child.type == "async" for child in n.children)
                
                result.nodes.append({
                    "id": func_id,
                    "type": "Function",
                    "name": name,
                    "uri": f"{filepath}#{name}",
                    "language": "typescript" if filepath.endswith((".ts", ".tsx")) else "javascript",
                    "metadata": {
                        "params": params,
                        "is_async": is_async,
                        "start_line": n.start_point[0] + 1,
                        "end_line": n.end_point[0] + 1,
                    }
                })
                
                # Add CONTAINS edge
                parent_id = current_class if current_class else module_id
                result.edges.append({
                    "id": f"contains:{parent_id}:{func_id}",
                    "type": "CONTAINS",
                    "source_id": parent_id,
                    "target_id": func_id,
                    "metadata": {"line": n.start_point[0] + 1}
                })
                
                prev_function = current_function
                current_function = func_id
                for child in n.children:
                    visit(child, depth + 1)
                current_function = prev_function
                return
            
            # Class declaration
            elif node_type == "class_declaration":
                name_node = n.child_by_field_name("name")
                name = source[name_node.start_byte:name_node.end_byte] if name_node else "anonymous"
                
                class_id = f"class:{filepath}:{name}"
                
                # Get superclass
                superclass = None
                extends_node = n.child_by_field_name("superclass")
                if extends_node:
                    superclass = source[extends_node.start_byte:extends_node.end_byte]
                
                result.nodes.append({
                    "id": class_id,
                    "type": "Class",
                    "name": name,
                    "uri": f"{filepath}#{name}",
                    "language": "typescript" if filepath.endswith((".ts", ".tsx")) else "javascript",
                    "metadata": {
                        "superclass": superclass,
                        "start_line": n.start_point[0] + 1,
                        "end_line": n.end_point[0] + 1,
                    }
                })
                
                # Add CONTAINS edge from module
                result.edges.append({
                    "id": f"contains:{module_id}:{class_id}",
                    "type": "CONTAINS",
                    "source_id": module_id,
                    "target_id": class_id,
                    "metadata": {"line": n.start_point[0] + 1}
                })
                
                prev_class = current_class
                current_class = class_id
                for child in n.children:
                    visit(child, depth + 1)
                current_class = prev_class
                return
            
            # Import statement
            elif node_type in ("import_statement", "import"):
                source_node = n.child_by_field_name("source")
                if source_node:
                    import_source = source[source_node.start_byte:source_node.end_byte]
                    import_source = import_source.strip('"\'')
                    
                    result.edges.append({
                        "id": f"import:{filepath}:{import_source}:{n.start_point[0]}",
                        "type": "IMPORTS",
                        "source_id": module_id,
                        "target_id": import_source,
                        "metadata": {
                            "line": n.start_point[0] + 1,
                            "source": import_source,
                        }
                    })
            
            # Export statement
            elif node_type == "export_statement":
                # Mark exported items
                declaration = n.child_by_field_name("declaration")
                if declaration:
                    decl_type = declaration.type
                    if decl_type in ("function_declaration", "class_declaration"):
                        name_node = declaration.child_by_field_name("name")
                        if name_node:
                            name = source[name_node.start_byte:name_node.end_byte]
                            result.edges.append({
                                "id": f"export:{filepath}:{name}",
                                "type": "EXPORTS",
                                "source_id": module_id,
                                "target_id": name,
                                "metadata": {"line": n.start_point[0] + 1}
                            })
            
            # Call expression
            elif node_type == "call_expression":
                if current_function:
                    func_node = n.child_by_field_name("function")
                    if func_node:
                        callee = source[func_node.start_byte:func_node.end_byte]
                        result.edges.append({
                            "id": f"call:{current_function}:{callee}:{n.start_point[0]}",
                            "type": "CALLS",
                            "source_id": current_function,
                            "target_id": callee,
                            "metadata": {"line": n.start_point[0] + 1}
                        })
            
            # Continue with children
            for child in n.children:
                visit(child, depth + 1)
        
        visit(node)
    
    def _parse_with_node(self, source: str, filepath: str, is_typescript: bool) -> JSParseResult:
        """Parse using Node.js and Babel as fallback."""
        result = JSParseResult()
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".js" if not is_typescript else ".ts", delete=False) as f:
            f.write(source)
            temp_path = f.name
        
        try:
            # Use a simple Node.js script to parse
            parse_script = """
const fs = require('fs');
const path = require('path');

try {
    const babel = require('@babel/parser');
    const code = fs.readFileSync(process.argv[2], 'utf8');
    const isTS = process.argv[3] === 'true';
    
    const ast = babel.parse(code, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        plugins: isTS ? ['typescript', 'decorators-legacy'] : ['decorators-legacy'],
        ranges: true,
    });
    
    const nodes = [];
    const edges = [];
    
    function traverse(node, parent, state) {
        if (!node) return;
        
        switch(node.type) {
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                nodes.push({
                    type: 'Function',
                    name: node.id?.name || parent?.id?.name || 'anonymous',
                    line: node.loc?.start?.line,
                    async: node.async,
                    generator: node.generator,
                });
                break;
            case 'ClassDeclaration':
                nodes.push({
                    type: 'Class',
                    name: node.id?.name || 'anonymous',
                    line: node.loc?.start?.line,
                    superClass: node.superClass?.name,
                });
                break;
            case 'ImportDeclaration':
                edges.push({
                    type: 'IMPORTS',
                    source: node.source?.value,
                    line: node.loc?.start?.line,
                });
                break;
            case 'ExportNamedDeclaration':
            case 'ExportDefaultDeclaration':
                edges.push({
                    type: 'EXPORTS',
                    line: node.loc?.start?.line,
                });
                break;
        }
        
        for (const key in node) {
            if (key === 'parent') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                child.forEach(c => traverse(c, node, state));
            } else if (typeof child === 'object' && child !== null) {
                traverse(child, node, state);
            }
        }
    }
    
    traverse(ast, null, {});
    console.log(JSON.stringify({nodes, edges, error: null}));
} catch(e) {
    console.log(JSON.stringify({nodes: [], edges: [], error: e.message}));
}
"""
            
            proc = subprocess.run(
                ["node", "-e", parse_script, temp_path, str(is_typescript).lower()],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                if data.get("error"):
                    result.errors.append(JSParseError(filepath, data["error"]))
                else:
                    module_id = f"module:{filepath}"
                    result.nodes.append({
                        "id": module_id,
                        "type": "Module",
                        "name": Path(filepath).stem,
                        "uri": filepath,
                        "language": "typescript" if is_typescript else "javascript",
                    })
                    
                    for node in data.get("nodes", []):
                        node["id"] = f"{node['type'].lower()}:{filepath}:{node['name']}"
                        node["uri"] = f"{filepath}#{node['name']}"
                        result.nodes.append(node)
                    
                    for edge in data.get("edges", []):
                        edge["source_id"] = module_id
                        edge["target_id"] = edge.get("source", "unknown")
                        result.edges.append(edge)
            else:
                result.errors.append(JSParseError(filepath, f"Node.js error: {proc.stderr}"))
                
        except FileNotFoundError:
            result.errors.append(JSParseError(filepath, "Node.js not available for JS parsing"))
        except Exception as e:
            result.errors.append(JSParseError(filepath, f"Parse error: {e}"))
        finally:
            os.unlink(temp_path)
        
        return result