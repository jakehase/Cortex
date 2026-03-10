"""
Parser Service - Business logic for file parsing operations.
"""

import asyncio
from typing import Dict, Any, List
from pathlib import Path
from cortex_server.parsers.python_parser import PythonParser, ParserConfig
from cortex_server.parsers.pdf_parser import PDFParser, PDFParserConfig
from cortex_server.parsers.js_parser import JSParser, JSParserConfig
from cortex_server.models.requests import (
    ParsePythonRequest, ParsePDFRequest, ParseJavaScriptRequest, ParseDirectoryRequest
)
from cortex_server.knowledge.graph import Graph, Node, Edge, NodeType, EdgeType


class ParserService:
    """Service for parsing files and extracting knowledge."""
    
    def __init__(self):
        self.python_parser = PythonParser(ParserConfig())
        self.pdf_parser = PDFParser(PDFParserConfig())
        self.js_parser = JSParser(JSParserConfig())
        self.graph = Graph()
    
    async def parse_python(self, request: ParsePythonRequest) -> Dict[str, Any]:
        """Parse Python code or file."""
        if request.file_path:
            result = self.python_parser.parse_file(request.file_path)
        elif request.code:
            # Write to temp file and parse
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
                f.write(request.code)
                temp_path = f.name
            try:
                result = self.python_parser.parse_file(temp_path)
            finally:
                os.unlink(temp_path)
        else:
            return {"error": "Either file_path or code must be provided"}
        
        # Add to knowledge graph
        for node in result.nodes:
            self._add_node_to_graph(node)
        for edge in result.edges:
            self._add_edge_to_graph(edge)
        
        return {
            "nodes": result.nodes,
            "edges": result.edges,
            "errors": [{"filepath": e.filepath, "message": e.message, "lineno": e.lineno, "col": e.col} for e in result.errors],
            "ok": result.ok,
        }
    
    async def parse_pdf(self, request: ParsePDFRequest) -> Dict[str, Any]:
        """Parse PDF file."""
        result = self.pdf_parser.parse_file(request.file_path)
        
        if result.error:
            return {"error": result.error}
        
        # Add to knowledge graph
        if result.document:
            self._add_node_to_graph(result.document)
            for page in result.pages:
                self._add_node_to_graph(page)
                # Add CONTAINS edge
                self.graph.add_edge(Edge(
                    id=f"CONTAINS:{result.document['id']}:{page['id']}",
                    type=EdgeType.CONTAINS,
                    source_id=result.document['id'],
                    target_id=page['id'],
                ))
        
        return result.to_dict()
    
    async def parse_javascript(self, request: ParseJavaScriptRequest) -> Dict[str, Any]:
        """Parse JavaScript/TypeScript code or file."""
        if request.file_path:
            result = self.js_parser.parse_file(request.file_path)
        elif request.code:
            import tempfile
            import os
            with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
                f.write(request.code)
                temp_path = f.name
            try:
                result = self.js_parser.parse_file(temp_path)
            finally:
                os.unlink(temp_path)
        else:
            return {"error": "Either file_path or code must be provided"}
        
        # Add to knowledge graph
        for node in result.nodes:
            self._add_node_to_graph(node)
        for edge in result.edges:
            self._add_edge_to_graph(edge)
        
        return {
            "nodes": result.nodes,
            "edges": result.edges,
            "errors": [{"filepath": e.filepath, "message": e.message, "lineno": e.lineno} for e in result.errors],
            "ok": result.ok,
        }
    
    async def parse_directory(self, request: ParseDirectoryRequest) -> Dict[str, Any]:
        """Parse all files in a directory."""
        path = Path(request.directory)
        if not path.exists():
            return {"error": f"Directory not found: {request.directory}"}
        
        results = {
            "files_parsed": 0,
            "nodes_added": 0,
            "edges_added": 0,
            "errors": [],
        }
        
        pattern = "**/*" if request.recursive else "*"
        
        for file_path in path.glob(pattern):
            if file_path.is_file():
                try:
                    ext = file_path.suffix.lower()
                    
                    if ext == ".py":
                        result = self.python_parser.parse_file(str(file_path))
                        for node in result.nodes:
                            self._add_node_to_graph(node)
                        for edge in result.edges:
                            self._add_edge_to_graph(edge)
                        results["nodes_added"] += len(result.nodes)
                        results["edges_added"] += len(result.edges)
                        results["files_parsed"] += 1
                    
                    elif ext in (".js", ".jsx", ".ts", ".tsx"):
                        result = self.js_parser.parse_file(str(file_path))
                        for node in result.nodes:
                            self._add_node_to_graph(node)
                        for edge in result.edges:
                            self._add_edge_to_graph(edge)
                        results["nodes_added"] += len(result.nodes)
                        results["edges_added"] += len(result.edges)
                        results["files_parsed"] += 1
                    
                    elif ext == ".pdf":
                        result = self.pdf_parser.parse_file(str(file_path))
                        if not result.error and result.document:
                            self._add_node_to_graph(result.document)
                            for page in result.pages:
                                self._add_node_to_graph(page)
                            results["nodes_added"] += len(result.pages) + 1
                            results["files_parsed"] += 1
                
                except Exception as e:
                    results["errors"].append(f"{file_path}: {str(e)}")
        
        return results
    
    def _add_node_to_graph(self, node_data: Dict[str, Any]) -> None:
        """Add a parsed node to the knowledge graph."""
        try:
            node_type = NodeType(node_data.get("type", "Entity"))
        except ValueError:
            node_type = NodeType.ENTITY
        
        node = Node(
            id=node_data["id"],
            type=node_type,
            name=node_data.get("name", "unknown"),
            uri=node_data.get("uri"),
            language=node_data.get("language"),
            metadata=node_data.get("metadata", {}),
        )
        self.graph.add_node(node)
    
    def _add_edge_to_graph(self, edge_data: Dict[str, Any]) -> None:
        """Add a parsed edge to the knowledge graph."""
        try:
            edge_type = EdgeType(edge_data.get("type", "REFERENCES"))
        except ValueError:
            edge_type = EdgeType.REFERENCES
        
        edge = Edge(
            id=edge_data["id"],
            type=edge_type,
            source_id=edge_data["source_id"],
            target_id=edge_data["target_id"],
            metadata=edge_data.get("metadata", {}),
        )
        self.graph.add_edge(edge)