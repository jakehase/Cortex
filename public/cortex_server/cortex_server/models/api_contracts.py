"""Shared response contracts for Cortex discovery and control-plane APIs."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ExtensibleModel(BaseModel):
    class Config:
        extra = "allow"


class ErrorResponse(ExtensibleModel):
    success: bool = False
    error: str
    request_id: Optional[str] = None
    path: Optional[str] = None


class ReadinessResponse(ExtensibleModel):
    status: str
    ready: bool
    service: str
    checks: Dict[str, Any]
    routerLoad: Dict[str, Any]


class HealthResponse(ExtensibleModel):
    status: str
    service: str
    readiness: bool
    checks: Dict[str, Any]
    routerLoad: Dict[str, Any]


class HttpCapability(ExtensibleModel):
    kind: str = "http"
    path: str
    methods: List[str]
    write: bool
    readPolicy: Optional[str] = None
    name: Optional[str] = None
    tag: Optional[str] = None


class WebSocketCapability(ExtensibleModel):
    kind: str = "websocket"
    path: str
    name: Optional[str] = None
    tag: Optional[str] = None


class CapabilityInventoryResponse(ExtensibleModel):
    schemaVersion: str
    security: Dict[str, Any]
    executionCapabilityPolicy: Dict[str, Any]
    capabilityCount: int
    httpCapabilityCount: int
    websocketCapabilityCount: int
    writeCapabilityCount: int
    capabilities: List[HttpCapability]
    websockets: List[WebSocketCapability]


class RootResponse(ExtensibleModel):
    name: str
    version: str
    description: str
    endpoints: Dict[str, str]


class LevelStatusResponse(ExtensibleModel):
    # Older level handlers place status under ``data`` while newer handlers
    # expose it at top level. Keep those compatibility shapes honest without
    # promising a required field that several canonical handlers do not emit.
    status: Optional[str] = None
    success: Optional[bool] = None
    level: Optional[int] = Field(default=None, ge=1, le=38)
    name: Optional[str] = None
    checks: Optional[Dict[str, Any]] = None


class NexusRouteLevel(ExtensibleModel):
    level: int = Field(ge=1, le=38)
    name: Optional[str] = None
    reason: Optional[str] = None
    method: Optional[str] = None
    score: Optional[float] = Field(default=None, ge=0, le=1)
    always_on: Optional[bool] = None


class NexusOrchestrationResponse(ExtensibleModel):
    success: Literal[True]
    recommended_levels: List[NexusRouteLevel] = Field(min_items=1, max_items=64)
    reasoning: List[str] = Field(max_items=128)
    routing_method: str = Field(min_length=1, max_length=1024)
    routing_markers: Dict[str, Any]
    contract: Dict[str, Any]
    workflow_checkpoint: Optional[Dict[str, Any]] = None


class NexusCodecProbeResponse(ExtensibleModel):
    success: bool
    query: str
    routing_method: str
    session_key: str
    codec_context: Dict[str, Any]
    contract: Dict[str, Any]
    truthBoundary: str


class AcceptedJobResponse(ExtensibleModel):
    success: bool
    accepted: bool
    job: Dict[str, Any]
    poll: str


class SingularityAnalysisResponse(ExtensibleModel):
    success: Literal[True]
    analysis: Dict[str, Any]
