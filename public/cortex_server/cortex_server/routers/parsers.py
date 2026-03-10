"""
Parser Router - API endpoints for file parsing.
"""

from fastapi import APIRouter, BackgroundTasks
from cortex_server.models.requests import (
    ParsePythonRequest, ParsePDFRequest, ParseJavaScriptRequest, ParseDirectoryRequest,
    ParseResultResponse
)
from cortex_server.services.parser_service import ParserService

router = APIRouter()
service = ParserService()


@router.post("/python")
async def parse_python(request: ParsePythonRequest):
    """Parse Python code or file."""
    try:
        result = await service.parse_python(request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/pdf", response_model=ParseResultResponse)
async def parse_pdf(request: ParsePDFRequest):
    """Parse PDF file."""
    try:
        result = await service.parse_pdf(request)
        return ParseResultResponse.success(result)
    except Exception as e:
        return ParseResultResponse.failure(str(e))


@router.post("/javascript", response_model=ParseResultResponse)
async def parse_javascript(request: ParseJavaScriptRequest):
    """Parse JavaScript/TypeScript code or file."""
    try:
        result = await service.parse_javascript(request)
        return ParseResultResponse.success(result)
    except Exception as e:
        return ParseResultResponse.failure(str(e))


@router.post("/directory", response_model=ParseResultResponse)
async def parse_directory(request: ParseDirectoryRequest, background_tasks: BackgroundTasks):
    """Parse all files in a directory."""
    try:
        # For large directories, this could be slow, so we run it directly
        # but could use background_tasks for very large operations
        result = await service.parse_directory(request)
        return ParseResultResponse.success(result)
    except Exception as e:
        return ParseResultResponse.failure(str(e))