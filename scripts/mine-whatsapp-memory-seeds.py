#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
from collections import Counter, defaultdict

# Focus on explicit durable-memory style statements, not device commands.
SEED_RULES = [
    ('identity', re.compile(r'\b(call me|my name is|you are gladys|you are|i am|i\'m|casual roommate|timezone|home assistant)\b', re.I)),
    ('remember', re.compile(r'\bremember\b', re.I)),
    ('project', re.compile(r'\b(cortex|pmhnp|billing|browserable|openclaw|clawdbot|home assistant|proxmox|github|repo|domain|website|server|docker|vm102|ct101|gladys)\b', re.I)),
    ('preference', re.compile(r'\b(i like|i prefer|favorite|want|need|would like|please keep|don\'t|do not|always|never)\b', re.I)),
]

COMMANDY = re.compile(r'^(gladys[, ]|check |turn |set |open |close |fix$|hello$|you there\??$|status\??$)', re.I)
BOT_PREFIXES = ('[clawdbot]', '[openclaw]')


def load_jsonl(path: Path):
    with path.open('r', encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def tags_for(text: str):
    tags = []
    for tag, pat in SEED_RULES:
        if pat.search(text):
            tags.append(tag)
    return sorted(set(tags))


def main():
    ap = argparse.ArgumentParser(description='Mine higher-signal memory seed messages from normalized WhatsApp JSONL.')
    ap.add_argument('input')
    ap.add_argument('--outdir', required=True)
    args = ap.parse_args()

    inp = Path(args.input)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    seeds = []
    by_tag = defaultdict(list)
    counts = Counter()

    for msg in load_jsonl(inp):
        if msg.get('kind') != 'chat':
            continue
        text = msg['text'].strip()
        if not text or text.startswith(BOT_PREFIXES):
            continue
        if COMMANDY.match(text) and len(text.split()) <= 8:
            continue
        tags = tags_for(text)
        if not tags:
            continue
        row = {
            'id': msg['id'],
            'date': msg['date'],
            'time': msg['time'],
            'speaker': msg['speaker'],
            'tags': tags,
            'text': text,
        }
        seeds.append(row)
        for t in tags:
            by_tag[t].append(row)
            counts[t] += 1

    with (outdir / 'seeds.jsonl').open('w', encoding='utf-8') as f:
        for row in seeds:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')

    with (outdir / 'seeds.md').open('w', encoding='utf-8') as f:
        f.write('# WhatsApp memory seeds\n\n')
        for tag in sorted(by_tag):
            f.write(f'## {tag}\n\n')
            for row in by_tag[tag][:500]:
                f.write(f"- [{row['date']} {row['time']}] {row['speaker']}: {row['text']}\n")
            f.write('\n')

    summary = {
        'seed_count': len(seeds),
        'tag_counts': dict(counts),
    }
    (outdir / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
