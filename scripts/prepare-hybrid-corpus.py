#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
from collections import Counter, defaultdict
from shutil import copy2

PREFERENCE_PATTERNS = [
    (re.compile(r'\b(call me|my name is|you are|i am in|timezone|i use|i have|i prefer|i like|interested in|working on|project|domain|repo|website|goal|remind me|remember this)\b', re.I), 'preference-or-fact'),
    (re.compile(r'\b(home assistant|proxmox|esphome|cortex|gladys|pmhnp|billing|browserable|github|whatsapp|openclaw|clawdbot)\b', re.I), 'system-or-project'),
    (re.compile(r'\b(admin / admin123|token|api key|ssh|port\s+\d+|http://|https://|domain|repo)\b', re.I), 'infra-or-secret-ref'),
]

BOT_PREFIXES = ('[clawdbot]', '[openclaw]')
ATTACHMENT_RE = re.compile(r'^<attached: .*?>$', re.I)


def load_jsonl(path: Path):
    with path.open('r', encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def classify_candidate(text: str):
    tags = []
    for pat, tag in PREFERENCE_PATTERNS:
        if pat.search(text):
            tags.append(tag)
    return sorted(set(tags))


def main():
    ap = argparse.ArgumentParser(description='Prepare hybrid memory corpus from WhatsApp export + recovered files.')
    ap.add_argument('--wa-jsonl', required=True)
    ap.add_argument('--recovered-root', required=True)
    ap.add_argument('--outdir', required=True)
    args = ap.parse_args()

    wa_jsonl = Path(args.wa_jsonl)
    recovered_root = Path(args.recovered_root)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / 'daily').mkdir(exist_ok=True)
    (outdir / 'candidates').mkdir(exist_ok=True)
    (outdir / 'sources').mkdir(exist_ok=True)

    chat_only = outdir / 'chat-only.jsonl'
    bot_only = outdir / 'bot-output.jsonl'
    candidates = outdir / 'candidates' / 'durable-candidates.jsonl'

    daily = defaultdict(list)
    stats = Counter()
    month_counts = Counter()

    with chat_only.open('w', encoding='utf-8') as f_chat, bot_only.open('w', encoding='utf-8') as f_bot, candidates.open('w', encoding='utf-8') as f_cand:
        for msg in load_jsonl(wa_jsonl):
            date = msg['date']
            text = msg['text']
            kind = msg['kind']
            speaker = msg['speaker']
            if ATTACHMENT_RE.match(text.strip()):
                kind = 'media-placeholder'
            row = {**msg, 'kind': kind}
            month = date.split('/')
            month_counts[f"20{month[2] if len(month[2])==2 else month[2]}-{int(month[0]):02d}"] += 1
            stats[f'kind:{kind}'] += 1

            if kind == 'bot-output':
                f_bot.write(json.dumps(row, ensure_ascii=False) + '\n')
                continue
            if kind == 'media-placeholder':
                stats['media-placeholders'] += 1
                continue

            f_chat.write(json.dumps(row, ensure_ascii=False) + '\n')
            daily[date].append(row)
            tags = classify_candidate(text)
            if tags:
                cand = {
                    'id': row['id'],
                    'date': date,
                    'time': row['time'],
                    'speaker': speaker,
                    'tags': tags,
                    'text': text,
                }
                f_cand.write(json.dumps(cand, ensure_ascii=False) + '\n')
                stats['candidate-messages'] += 1

    # write daily markdown files
    for date, msgs in daily.items():
        m, d, y = date.split('/')
        yyyy = f"20{y}" if len(y) == 2 else y
        out = outdir / 'daily' / f'{yyyy}-{int(m):02d}-{int(d):02d}.md'
        with out.open('w', encoding='utf-8') as f:
            f.write(f'# WhatsApp {yyyy}-{int(m):02d}-{int(d):02d}\n\n')
            for msg in msgs:
                f.write(f"- [{msg['time']}] {msg['speaker']}: {msg['text']}\n")

    # copy recovered transcript-memory files into sources/
    copied = []
    for sub in ['recovered-files', 'recovered-from-toolcalls', 'search-snippets']:
        src = recovered_root / sub
        if not src.exists():
            continue
        dst = outdir / 'sources' / sub
        dst.mkdir(parents=True, exist_ok=True)
        for p in src.rglob('*'):
            if p.is_file():
                rel = p.relative_to(src)
                target = dst / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                copy2(p, target)
                copied.append(str(target))

    summary = {
        'wa_jsonl': str(wa_jsonl),
        'recovered_root': str(recovered_root),
        'chat_message_count': stats['kind:chat'],
        'bot_output_count': stats['kind:bot-output'],
        'media_placeholder_count': stats['kind:media-placeholder'] + stats['media-placeholders'],
        'candidate_message_count': stats['candidate-messages'],
        'daily_files': len(list((outdir / 'daily').glob('*.md'))),
        'months': dict(month_counts),
        'copied_source_files': len(copied),
    }
    (outdir / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    (outdir / 'summary.txt').write_text(
        '\n'.join([
            f"chat_message_count: {summary['chat_message_count']}",
            f"bot_output_count: {summary['bot_output_count']}",
            f"media_placeholder_count: {summary['media_placeholder_count']}",
            f"candidate_message_count: {summary['candidate_message_count']}",
            f"daily_files: {summary['daily_files']}",
            'months:',
            *[f"  {k}: {v}" for k, v in sorted(month_counts.items())],
            f"copied_source_files: {summary['copied_source_files']}",
        ]), encoding='utf-8')
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
