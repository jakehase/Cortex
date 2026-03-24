#!/usr/bin/env python3
"""Mirror the live PMHNP public surfaces into this recovered workspace.

This script intentionally captures only the verified public files/routes that were
still available during recovery. It does not attempt to recreate private backend
source code.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from email.utils import formatdate

BASE = Path(__file__).resolve().parents[1]
PUBLIC = BASE / 'public'
RECOVERY = BASE / 'docs' / 'recovery'

URL_MAP = {
    'https://pmhnpbilling.com/': PUBLIC / 'index.html',
    'https://pmhnpbilling.com/ai-agent.html': PUBLIC / 'ai-agent.html',
    'https://pmhnpbilling.com/robots.txt': PUBLIC / 'robots.txt',
    'https://pmhnpbilling.com/sitemap.xml': PUBLIC / 'sitemap.xml',
    'https://pmhnpbilling.com/app/': PUBLIC / 'app' / 'index.html',
    'https://pmhnpbilling.com/app/app.js': PUBLIC / 'app' / 'app.js',
    'https://pmhnpbilling.com/app/styles.css': PUBLIC / 'app' / 'styles.css',
    'https://pmhnpbilling.com/app/intake.html': PUBLIC / 'app' / 'intake.html',
    'https://pmhnpbilling.com/app/data/dashboard-snapshot.json': PUBLIC / 'app' / 'data' / 'dashboard-snapshot.json',
}

PROBE_URLS = [
    'https://pmhnpbilling.com/client/session',
    'https://pmhnpbilling.com/client/snapshot',
    'https://api.pmhnpbilling.com/health',
]

HEADERS = {
    'User-Agent': 'pmhnp-denial-copilot-recovery/0.1',
}


def fetch(url: str) -> tuple[int, bytes, dict[str, str]]:
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.status, resp.read(), dict(resp.headers.items())
    except HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers.items())
    except URLError as exc:
        return 0, str(exc).encode('utf-8'), {}


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    RECOVERY.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {
        'mirrored_at': formatdate(usegmt=True),
        'files': [],
        'probes': [],
    }

    for url, path in URL_MAP.items():
        status, body, headers = fetch(url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        manifest['files'].append({
            'url': url,
            'path': str(path.relative_to(BASE)),
            'status': status,
            'bytes': len(body),
            'content_type': headers.get('Content-Type'),
            'last_modified': headers.get('Last-Modified'),
            'etag': headers.get('ETag'),
        })
        print(f'{status:>3} {url} -> {path.relative_to(BASE)}')

    probe_dir = RECOVERY / 'live-probes'
    probe_dir.mkdir(parents=True, exist_ok=True)
    for url in PROBE_URLS:
        status, body, headers = fetch(url)
        name = url.replace('https://', '').replace('/', '__') + '.txt'
        out = probe_dir / name
        payload = '\n'.join([
            f'URL: {url}',
            f'STATUS: {status}',
            'HEADERS:',
            *[f'{k}: {v}' for k, v in headers.items()],
            '',
            'BODY:',
            body.decode('utf-8', 'replace'),
        ])
        out.write_text(payload, encoding='utf-8')
        manifest['probes'].append({
            'url': url,
            'path': str(out.relative_to(BASE)),
            'status': status,
            'bytes': len(body),
            'content_type': headers.get('Content-Type'),
        })
        print(f'{status:>3} {url} -> {out.relative_to(BASE)}')

    (RECOVERY / 'mirror-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Wrote {(RECOVERY / "mirror-manifest.json").relative_to(BASE)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
