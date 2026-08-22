#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from pathlib import Path


def post_json(url: str, payload: dict, timeout: int = 20):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode('utf-8', 'replace')
        return resp.status, json.loads(body)


def chunk_text(text: str, max_len: int = 900):
    paras = [p.strip() for p in text.split('\n\n') if p.strip()]
    out = []
    cur = ''
    for p in paras:
        if len(cur) + len(p) + 2 <= max_len:
            cur = p if not cur else cur + '\n\n' + p
        else:
            if cur:
                out.append(cur)
            if len(p) <= max_len:
                cur = p
            else:
                # hard wrap long paragraphs
                for i in range(0, len(p), max_len):
                    out.append(p[i:i + max_len])
                cur = ''
    if cur:
        out.append(cur)
    return out


def sha(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def load_state(path: Path):
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text())
        return set(data.get('ingested', []))
    except Exception:
        return set()


def save_state(path: Path, seen: set[str]):
    path.write_text(json.dumps({'ingested': sorted(seen)}, indent=2))


def build_records(recovered_root: Path, seeds_md: Path, seed_limit: int):
    records = []

    # recovered files first
    for p in sorted((recovered_root / 'recovered-files').rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(recovered_root / 'recovered-files')
        text = p.read_text(encoding='utf-8', errors='replace').strip()
        if not text:
            continue
        for idx, chunk in enumerate(chunk_text(text), 1):
            records.append({
                'content': chunk,
                'tags': ['recovered-file'],
                'metadata': {
                    'source': 'recovered-file',
                    'path': str(rel),
                    'chunk': idx,
                },
            })

    # high-signal seeds markdown
    count = 0
    if seeds_md.exists():
        for line in seeds_md.read_text(encoding='utf-8', errors='replace').splitlines():
            if not line.startswith('- ['):
                continue
            if count >= seed_limit:
                break
            text = line[2:].strip()
            if len(text) < 40:
                continue
            records.append({
                'content': text,
                'tags': ['whatsapp', 'high-signal'],
                'metadata': {
                    'source': 'whatsapp-high-signal',
                },
            })
            count += 1

    return records


def main():
    ap = argparse.ArgumentParser(description='Ingest recovered seeds into staged Cortex /l22/store.')
    ap.add_argument('--base-url', default='http://127.0.0.1:18888')
    ap.add_argument('--recovered-root', default='/root/recovery/clawd-transcript-recovery')
    ap.add_argument('--seeds-md', default='/root/recovery/cortex-rebuild-2026-03-14/corpus/wa-seeds/high-signal-seeds.md')
    ap.add_argument('--state-file', default='/root/recovery/cortex-rebuild-2026-03-14/ingest/ingest-state.json')
    ap.add_argument('--log-file', default='/root/recovery/cortex-rebuild-2026-03-14/ingest/ingest-log.jsonl')
    ap.add_argument('--seed-limit', type=int, default=300)
    ap.add_argument('--sleep-ms', type=int, default=50)
    args = ap.parse_args()

    state_path = Path(args.state_file)
    log_path = Path(args.log_file)
    state_path.parent.mkdir(parents=True, exist_ok=True)

    seen = load_state(state_path)
    records = build_records(Path(args.recovered_root), Path(args.seeds_md), args.seed_limit)

    total = 0
    sent = 0
    skipped = 0
    with log_path.open('a', encoding='utf-8') as log:
        for rec in records:
            total += 1
            key = sha(json.dumps(rec, sort_keys=True))
            if key in seen:
                skipped += 1
                continue
            payload = {
                'content': rec['content'],
                'tags': rec['tags'],
                'metadata': rec['metadata'],
            }
            try:
                status, resp = post_json(args.base_url.rstrip('/') + '/l22/store', payload)
                log.write(json.dumps({'ok': True, 'status': status, 'payload': rec['metadata'], 'response': resp}) + '\n')
                seen.add(key)
                sent += 1
            except Exception as e:
                log.write(json.dumps({'ok': False, 'payload': rec['metadata'], 'error': str(e)}) + '\n')
            if args.sleep_ms:
                time.sleep(args.sleep_ms / 1000)
    save_state(state_path, seen)
    print(json.dumps({'total_candidates': total, 'sent': sent, 'skipped': skipped, 'state_file': str(state_path), 'log_file': str(log_path)}, indent=2))


if __name__ == '__main__':
    main()
