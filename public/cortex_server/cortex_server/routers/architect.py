import os
import subprocess
import importlib.util

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


class ExtendRequest(BaseModel):
    filename: str
    code: str
    dependencies: Optional[List[str]] = []


class ExtendResponse(BaseModel):
    status: str
    message: str
    module: str


def validate_router_code(code: str) -> bool:
    return "APIRouter" in code


@router.post("/extend", response_model=ExtendResponse)
def extend_router(request: ExtendRequest):
    if not validate_router_code(request.code):
        raise HTTPException(status_code=400, detail="Code must include APIRouter")

    if request.dependencies:
        for dep in request.dependencies:
            subprocess.run(
                ["pip", "install", dep],
                check=True,
                capture_output=True,
                text=True,
            )

    target_path = os.path.join(
        "/root/cortex_server/cortex_server/routers",
        request.filename,
    )
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(request.code)

    module_name = os.path.splitext(request.filename)[0]
    return ExtendResponse(
        status="ok",
        message=f"Router written to {target_path}",
        module=module_name,
    )


@router.post("/reload", response_model=ExtendResponse)
def reload_router():
    return ExtendResponse(
        status="ok",
        message="Reload placeholder: manual restart required",
        module="",
    )
