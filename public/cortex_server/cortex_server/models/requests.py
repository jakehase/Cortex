"""
Pydantic models for request/response validation.
"""

from typing import Dict, List, Optional, Any, Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """Generic API response wrapper."""
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None

    @classmethod
    def success(cls, data: T):
        return cls(success=True, data=data, error=None)

    @classmethod
    def failure(cls, error: str):
        return cls(success=False, data=None, error=error)


# Knowledge Graph Request Models
class GraphQueryRequest(BaseModel):
    query: str
    node_type: Optional[str] = None
    limit: int = 100


class GraphNodeCreateRequest(BaseModel):
    id: Optional[str] = None
    type: str
    name: str
    uri: Optional[str] = None
    language: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphEdgeCreateRequest(BaseModel):
    id: Optional[str] = None
    type: str
    source_id: str
    target_id: str
    weight: Optional[float] = None
    context: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GraphNeighborRequest(BaseModel):
    node_id: str
    edge_type: Optional[str] = None


# Parser Request Models
class ParsePythonRequest(BaseModel):
    code: Optional[str] = None
    file_path: Optional[str] = None


class ParsePDFRequest(BaseModel):
    file_path: str
    extract_structure: bool = True


class ParseJavaScriptRequest(BaseModel):
    code: Optional[str] = None
    file_path: Optional[str] = None


class ParseDirectoryRequest(BaseModel):
    directory: str
    recursive: bool = True
    exclude_patterns: List[str] = Field(default_factory=lambda: [
        "**/venv/**", "**/.venv/**", "**/__pycache__/**", 
        "**/.git/**", "**/node_modules/**"
    ])


# Tool Request Models
class FFMPEGConvertRequest(BaseModel):
    input_path: str
    output_path: str
    codec: Optional[str] = None
    quality: Optional[int] = None
    start_time: Optional[float] = None
    duration: Optional[float] = None


class FFMPEGExtractAudioRequest(BaseModel):
    input_path: str
    output_path: str
    format: str = "mp3"


class FFMPEGThumbnailRequest(BaseModel):
    input_path: str
    output_path: str
    time: float = 0.5


class GitCloneRequest(BaseModel):
    repo_url: str
    destination: str
    branch: Optional[str] = None
    depth: Optional[int] = None


class GitPullRequest(BaseModel):
    repo_path: str
    remote: str = "origin"
    branch: Optional[str] = None
    rebase: bool = False


class GitCommitRequest(BaseModel):
    repo_path: str
    message: str
    files: Optional[List[str]] = None
    amend: bool = False


class DockerRunRequest(BaseModel):
    image: str
    command: Optional[List[str]] = None
    name: Optional[str] = None
    env: Dict[str, str] = Field(default_factory=dict)
    ports: Dict[str, str] = Field(default_factory=dict)  # container_port -> host_port
    volumes: Dict[str, str] = Field(default_factory=dict)  # host_path -> container_path


class DockerBuildRequest(BaseModel):
    path: str
    tag: str
    dockerfile: str = "Dockerfile"


# Response Models
class GraphQueryResponse(APIResponse[Dict[str, Any]]):
    pass


class GraphNodeResponse(APIResponse[Dict[str, Any]]):
    pass


class GraphEdgeResponse(APIResponse[Dict[str, Any]]):
    pass


class ParseResultResponse(APIResponse[Dict[str, Any]]):
    pass


class ToolResultResponse(APIResponse[Dict[str, Any]]):
    pass


class JobStatusResponse(APIResponse[Dict[str, Any]]):
    pass