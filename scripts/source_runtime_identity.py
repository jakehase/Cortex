#!/usr/bin/env python3
"""Create a secret-minimized source/runtime/image identity receipt."""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_EXCLUDES = (".git/**", "node_modules/**", "artifacts/**", "tmp/**", "__pycache__/**", "*.pyc", "*.sqlite", "*.db")
SECRET_BASENAMES = {".env", "credentials.json", "openclaw.json", "id_rsa", "id_ed25519", "known_hosts"}
SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".kdbx"}
SECRET_DIRS = {".ssh", ".gnupg", "secrets", "credentials"}
SHA256_RE = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""): h.update(chunk)
    return h.hexdigest()


def secret_like(path: Path) -> bool:
    return path.name in SECRET_BASENAMES or path.name.startswith(".env.") or path.suffix.lower() in SECRET_SUFFIXES or any(part.lower() in SECRET_DIRS for part in path.parts)


def source_receipt(root: Path, excludes=DEFAULT_EXCLUDES, max_files: int = 50000) -> dict[str, Any]:
    root=root.resolve(); files=[]; skipped_secret=[]; aggregate=hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink(): continue
        rel=path.relative_to(root).as_posix()
        if any(fnmatch.fnmatch(rel,p) or fnmatch.fnmatch(path.name,p) for p in excludes): continue
        if secret_like(Path(rel)):
            skipped_secret.append(rel); continue
        if len(files) >= max_files: raise RuntimeError("max_files_exceeded")
        digest=sha256_file(path); stat=path.stat(); rec={"path":rel,"sha256":digest,"bytes":stat.st_size,"mode":f"{stat.st_mode&0o777:04o}"}
        files.append(rec); aggregate.update(f"{digest}  {rel}\n".encode())
    return {"root":str(root),"algorithm":"sha256","contentDigest":aggregate.hexdigest(),"fileCount":len(files),"files":files,"secretLikeFilesSkipped":sorted(skipped_secret),"fileContentsIncluded":False}


def git_receipt(root: Path, timeout: float = 5.0) -> dict[str, Any]:
    def run(*args): return subprocess.run(["git","-C",str(root),*args],capture_output=True,text=True,timeout=timeout,check=True).stdout.strip()
    try:
        commit=run("rev-parse","HEAD"); branch=run("rev-parse","--abbrev-ref","HEAD"); status=run("status","--porcelain=v1")
        return {"available":True,"commit":commit,"branch":branch,"dirty":bool(status),"dirtyEntryCount":len(status.splitlines()) if status else 0,"statusDigest":hashlib.sha256(status.encode()).hexdigest()}
    except (subprocess.SubprocessError, OSError): return {"available":False}


def parse_images(values: list[str]) -> list[dict[str,str]]:
    images=[]
    for value in values:
        if "=" not in value: raise ValueError("image identity must be name=sha256:digest")
        name,digest=value.split("=",1); digest=digest.strip().lower()
        if not name.strip() or not SHA256_RE.fullmatch(digest): raise ValueError("invalid image digest")
        images.append({"name":name.strip(),"digest":digest if digest.startswith("sha256:") else f"sha256:{digest}"})
    return images


def runtime_artifacts(values: list[str]) -> list[dict[str,Any]]:
    records=[]
    for value in values:
        path=Path(value).resolve()
        if secret_like(path) or not path.is_file() or path.is_symlink(): raise ValueError("runtime artifact rejected")
        stat=path.stat(); records.append({"path":str(path),"sha256":sha256_file(path),"bytes":stat.st_size,"mode":f"{stat.st_mode&0o777:04o}"})
    return records


def build(root: Path, images: list[str], runtime_files: list[str]) -> dict[str,Any]:
    source=source_receipt(root)
    runtime = runtime_artifacts(runtime_files)
    return {
        "schema": "cortex.source-runtime-identity.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "git": git_receipt(root),
        "images": parse_images(images),
        "runtimeArtifacts": runtime,
        "runtimeIdentityScope": "declared_artifacts_only",
        "runtimeArtifactCount": len(runtime),
        "productionRuntimeInspected": False,
        "productionRuntimeMutated": False,
        "secretsIncluded": False,
        "providerCallMade": False,
    }


def immutable_write(path: Path, payload: dict[str,Any]) -> None:
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o444)
    with os.fdopen(fd,"w") as f: json.dump(payload,f,indent=2,sort_keys=True); f.write("\n")


def main() -> int:
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("--source-root",required=True); p.add_argument("--image",action="append",default=[]); p.add_argument("--runtime-artifact",action="append",default=[]); p.add_argument("--output",required=True)
    args=p.parse_args()
    try: result=build(Path(args.source_root),args.image,args.runtime_artifact); immutable_write(Path(args.output),result); print(json.dumps(result,indent=2,sort_keys=True)); return 0
    except Exception as exc: print(json.dumps({"schema":"cortex.source-runtime-identity.v1","ok":False,"error":type(exc).__name__,"secretsIncluded":False,"runtimeInspectedOrMutated":False},indent=2)); return 2


if __name__=="__main__": raise SystemExit(main())
