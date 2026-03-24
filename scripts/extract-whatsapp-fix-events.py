#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
from collections import Counter

FIX_PATTERNS = [
    ('fix', re.compile(r'\b(fix|fixed|repair|repaired|resolved|working again|healthy again|reconnect|reconnected|restored|restore|rollback)\b', re.I)),
    ('config', re.compile(r'\b(configured|set up|setup|set to|enabled|disabled|switched|changed|updated|patched|wired|mounted|mapped|bound|auth|oauth|restart policy|systemd|pm2|cron|compose|docker)\b', re.I)),
    ('deploy', re.compile(r'\b(installed|created|added|deployed|built|started|stopped|restarted|migrated|promoted|backed up|backup|snapshot|stage|staged)\b', re.I)),
    ('cortex', re.compile(r'\b(cortex|l7|l22|mnemosyne|librarian|knowledge graph|pmhnp|oracle|gladys|clawdbot|openclaw|codex|whatsapp)\b', re.I)),
]


def load_jsonl(path: Path):
    with path.open('r', encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def tags_for(text: str):
    tags = []
    for tag, pat in FIX_PATTERNS:
        if pat.search(text):
            tags.append(tag)
    return sorted(set(tags))


def main():
    ap = argparse.ArgumentParser(description='Extract likely fix/change events from normalized WhatsApp JSONL.')
    ap.add_argument('input')
    ap.add_argument('--outdir', required=True)
    args = ap.parse_args()

    inp = Path(args.input)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    rows = []
    counts = Counter()
    for msg in load_jsonl(inp):
        text = msg['text'].strip()
        if not text:
            continue
        tags = tags_for(text)
        # Keep only messages with both a change/fix signal and a system/topic signal,
        # or long bot outputs that clearly describe actions taken.
        is_bot = msg.get('kind') == 'bot-output'
        if not tags:
            continue
        if not (('cortex' in tags and ('fix' in tags or 'config' in tags or 'deploy' in tags)) or (is_bot and len(text) >= 120 and ('fix' in tags or 'config' in tags or 'deploy' in tags))):
            continue
        row = {
            'id': msg['id'],
            'date': msg['date'],
            'time': msg['time'],
            'speaker': msg['speaker'],
            'kind': msg['kind'],
            'tags': tags,
            'text': text,
        }
        rows.append(row)
        for t in tags:
            counts[t] += 1

    with (outdir / 'fix-events.jsonl').open('w', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')

    with (outdir / 'fix-events.md').open('w', encoding='utf-8') as f:
        f.write('# WhatsApp fix/change events\n\n')
        current_date = None
        for row in rows:
            if row['date'] != current_date:
                current_date = row['date']
                f.write(f'## {current_date}\n\n')
            f.write(f"- [{row['time']}] {row['speaker']} ({row['kind']}; {', '.join(row['tags'])})\n")
            for ln in row['text'].splitlines():
                f.write(f"  {ln}\n")
            f.write('\n')

    (outdir / 'summary.json').write_text(json.dumps({'count': len(rows), 'tag_counts': dict(counts)}, indent=2), encoding='utf-8')
    print(json.dumps({'count': len(rows), 'tag_counts': dict(counts)}, indent=2))


if __name__ == '__main__':
    main()
