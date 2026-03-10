"""
PDF File Parser - Extract text, structure, and metadata from PDF files.
"""

import json
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
import statistics


@dataclass
class PDFParserConfig:
    """Configuration for PDF parser."""
    column_detection: bool = True
    heading_size_ratio: float = 1.3
    line_tolerance: float = 3.0
    min_heading_length: int = 3
    max_heading_length: int = 200
    debug: bool = False


@dataclass
class PDFParseResult:
    """Result of parsing a PDF file."""
    document: Optional[Dict[str, Any]] = None
    pages: List[Dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "document": self.document,
            "pages": self.pages,
            "error": self.error,
        }


class PDFParser:
    """Parse PDF files and extract knowledge graph entities."""
    
    def __init__(self, config: Optional[PDFParserConfig] = None):
        self.config = config or PDFParserConfig()
        self._pdfplumber = None
        try:
            import pdfplumber
            self._pdfplumber = pdfplumber
        except ImportError:
            raise ImportError("pdfplumber is required for PDF parsing. Install with: pip install pdfplumber")
    
    def parse_file(self, path: str) -> PDFParseResult:
        """Parse a PDF file and return extracted entities."""
        result = PDFParseResult()
        
        try:
            with self._pdfplumber.open(path) as pdf:
                # Extract metadata
                doc_meta = pdf.metadata or {}
                
                result.document = {
                    "id": f"doc:{Path(path).name}",
                    "type": "Document",
                    "name": Path(path).stem,
                    "uri": path,
                    "language": "unknown",
                    "metadata": {
                        "title": doc_meta.get("Title"),
                        "author": doc_meta.get("Author"),
                        "creator": doc_meta.get("Creator"),
                        "producer": doc_meta.get("Producer"),
                        "created": doc_meta.get("CreationDate"),
                        "modified": doc_meta.get("ModDate"),
                        "pages": len(pdf.pages),
                        "format": "pdf",
                    }
                }
                
                # Parse each page
                for i, page in enumerate(pdf.pages, start=1):
                    page_result = self._parse_page(page, i, result.document["id"])
                    result.pages.append(page_result)
                    
        except Exception as e:
            result.error = str(e)
        
        return result
    
    def _parse_page(self, page, page_num: int, doc_id: str) -> Dict[str, Any]:
        """Parse a single page."""
        chars = page.chars or []
        
        if not chars:
            return {
                "id": f"{doc_id}:page:{page_num}",
                "type": "Page",
                "name": f"Page {page_num}",
                "uri": f"{doc_id}#page={page_num}",
                "metadata": {
                    "page_number": page_num,
                    "text": "",
                    "structures": [],
                }
            }
        
        # Detect columns and build lines
        if self.config.column_detection:
            columns = self._detect_columns(chars)
        else:
            columns = [{"x0_min": min(c["x0"] for c in chars), "x1_max": max(c["x1"] for c in chars)}]
        
        all_lines = []
        for col in columns:
            col_chars = [c for c in chars if col["x0_min"] <= c["x0"] <= col["x1_max"]]
            col_lines = self._build_lines(col_chars)
            all_lines.extend(col_lines)
        
        # Sort lines by y-position (top to bottom)
        all_lines.sort(key=lambda l: l["top"])
        
        # Detect structure (headings, paragraphs)
        structures = self._detect_structure(all_lines)
        
        # Build full text
        text = "\n".join(line["text"] for line in all_lines)
        
        page_id = f"{doc_id}:page:{page_num}"
        
        return {
            "id": page_id,
            "type": "Page",
            "name": f"Page {page_num}",
            "uri": f"{doc_id}#page={page_num}",
            "metadata": {
                "page_number": page_num,
                "text": text,
                "structures": structures,
                "columns": len(columns),
            }
        }
    
    def _detect_columns(self, chars: List[Dict]) -> List[Dict[str, float]]:
        """Detect text columns by analyzing x-positions."""
        if not chars:
            return []
        
        # Get x0 positions
        x0s = [c["x0"] for c in chars]
        
        # Use histogram to find clusters
        min_x, max_x = min(x0s), max(x0s)
        if max_x - min_x < 100:  # Too narrow for columns
            return [{"x0_min": min_x, "x1_max": max_x}]
        
        # Simple clustering: split if there's a large gap
        sorted_chars = sorted(chars, key=lambda c: c["x0"])
        columns = []
        current_col = {"x0_min": sorted_chars[0]["x0"], "x1_max": sorted_chars[0]["x1"]}
        
        for char in sorted_chars[1:]:
            # If large gap, start new column
            if char["x0"] - current_col["x1_max"] > 50:  # 50pt gap threshold
                columns.append(current_col)
                current_col = {"x0_min": char["x0"], "x1_max": char["x1"]}
            else:
                current_col["x1_max"] = max(current_col["x1_max"], char["x1"])
        
        columns.append(current_col)
        
        # Filter out very narrow columns (likely noise)
        columns = [c for c in columns if c["x1_max"] - c["x0_min"] > 30]
        
        return columns if columns else [{"x0_min": min_x, "x1_max": max_x}]
    
    def _build_lines(self, chars: List[Dict]) -> List[Dict[str, Any]]:
        """Group characters into lines."""
        if not chars:
            return []
        
        # Sort by y-position, then x-position
        sorted_chars = sorted(chars, key=lambda c: (c["top"], c["x0"]))
        
        lines = []
        current_line = {"chars": [sorted_chars[0]], "top": sorted_chars[0]["top"]}
        
        for char in sorted_chars[1:]:
            # Check if same line (within tolerance)
            if abs(char["top"] - current_line["top"]) <= self.config.line_tolerance:
                current_line["chars"].append(char)
            else:
                # Finish current line
                lines.append(self._finalize_line(current_line))
                current_line = {"chars": [char], "top": char["top"]}
        
        # Don't forget the last line
        lines.append(self._finalize_line(current_line))
        
        return lines
    
    def _finalize_line(self, line: Dict) -> Dict[str, Any]:
        """Finalize a line by sorting chars and extracting properties."""
        chars = sorted(line["chars"], key=lambda c: c["x0"])
        
        text = "".join(c["text"] for c in chars)
        font_sizes = [c.get("size", 0) for c in chars if c.get("size")]
        font_names = [c.get("fontname", "") for c in chars if c.get("fontname")]
        
        return {
            "text": text,
            "top": line["top"],
            "x0": chars[0]["x0"],
            "x1": chars[-1]["x1"],
            "font_size": statistics.mean(font_sizes) if font_sizes else 0,
            "font_name": font_names[0] if font_names else "",
            "is_bold": any("Bold" in f or "bold" in f for f in font_names),
        }
    
    def _detect_structure(self, lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Detect headings and paragraphs."""
        if not lines:
            return []
        
        structures = []
        
        # Calculate median font size for heading detection
        font_sizes = [l["font_size"] for l in lines if l["font_size"] > 0]
        if font_sizes:
            median_size = statistics.median(font_sizes)
        else:
            median_size = 12  # Default
        
        current_paragraph_lines = []
        paragraph_start = 0
        
        for i, line in enumerate(lines):
            is_heading = self._is_heading(line, median_size)
            
            if is_heading:
                # Finish current paragraph if any
                if current_paragraph_lines:
                    structures.append({
                        "type": "Paragraph",
                        "text": " ".join(l["text"] for l in current_paragraph_lines),
                        "start_line": paragraph_start,
                        "end_line": i - 1,
                    })
                    current_paragraph_lines = []
                
                # Add heading
                structures.append({
                    "type": "Section",
                    "heading": line["text"],
                    "level": self._heading_level(line, median_size),
                    "line": i,
                    "font_size": line["font_size"],
                })
                paragraph_start = i + 1
            else:
                current_paragraph_lines.append(line)
        
        # Don't forget the last paragraph
        if current_paragraph_lines:
            structures.append({
                "type": "Paragraph",
                "text": " ".join(l["text"] for l in current_paragraph_lines),
                "start_line": paragraph_start,
                "end_line": len(lines) - 1,
            })
        
        return structures
    
    def _is_heading(self, line: Dict[str, Any], median_size: float) -> bool:
        """Determine if a line is a heading."""
        text = line["text"].strip()
        
        # Length check
        if len(text) < self.config.min_heading_length:
            return False
        if len(text) > self.config.max_heading_length:
            return False
        
        # Font size check
        if line["font_size"] >= median_size * self.config.heading_size_ratio:
            return True
        
        # Bold check
        if line["is_bold"] and len(text) < 100:
            return True
        
        return False
    
    def _heading_level(self, line: Dict[str, Any], median_size: float) -> int:
        """Estimate heading level (1-6) based on font size."""
        ratio = line["font_size"] / median_size if median_size > 0 else 1
        
        if ratio >= 2.0:
            return 1
        elif ratio >= 1.6:
            return 2
        elif ratio >= 1.4:
            return 3
        elif ratio >= 1.2:
            return 4
        elif ratio >= 1.1:
            return 5
        else:
            return 6