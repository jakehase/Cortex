#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.server
import socketserver
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--dir', default='artifacts/cortex_roadmap/r9_adaptive_routing_brain/step11')
    args = parser.parse_args()

    directory = Path(args.dir).resolve()
    if not directory.exists():
        raise SystemExit(f'missing dashboard dir: {directory}')

    handler = http.server.SimpleHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', args.port), lambda *a, **kw: handler(*a, directory=str(directory), **kw)) as httpd:
        print(f'Serving R9 dashboard at http://127.0.0.1:{args.port}/dashboard_live_local.html')
        httpd.serve_forever()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
