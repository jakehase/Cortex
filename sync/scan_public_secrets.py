#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path
import sys

FORBIDDEN_FILE_PATTERNS = [
    re.compile(r"(^|/)\.env(\.|$)"),
    re.compile(r"(^|/).*\.(pem|key|p12|pfx|crt|der)$", re.IGNORECASE),
    re.compile(r"(^|/)(id_rsa|id_dsa|id_ed25519)$"),
    re.compile(r"(^|/).*(secret|credential|token|passwd|password).*$", re.IGNORECASE),
    re.compile(r"(^|/).*(\.sqlite3?|\.db|\.log|\.pid|\.jsonl)$", re.IGNORECASE),
]

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (RSA|EC|OPENSSH|DSA|PGP)? ?PRIVATE KEY-----"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"AIza[0-9A-Za-z\-_]{35}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    re.compile(r"(?i)authorization\s*:\s*bearer\s+[A-Za-z0-9\-\._~\+\/]+=*"),
]


def scan(root: Path) -> list[str]:
    findings: list[str] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()

        for pat in FORBIDDEN_FILE_PATTERNS:
            if pat.search(rel):
                findings.append(f"forbidden filename pattern: {rel}")
                break

        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            findings.append(f"unreadable file: {rel}")
            continue

        for idx, line in enumerate(text.splitlines(), start=1):
            for pat in SECRET_PATTERNS:
                if pat.search(line):
                    findings.append(f"secret-like pattern in {rel}:{idx}")
                    break
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/opt/clawdbot/public")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        print(f"ERROR: export root does not exist: {root}")
        return 2

    findings = scan(root)
    if findings:
        print("SECRET_SCAN_FAIL")
        for item in findings:
            print(item)
        return 1

    print("SECRET_SCAN_PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
