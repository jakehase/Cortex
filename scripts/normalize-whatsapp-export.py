#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
from collections import Counter

# WhatsApp export format examples:
# [1/27/26, 10:05:41 AM] Jake: Hello
# [1/27/26, 10:05:41 AM] Jake: Hello   (contains narrow no-break space)
HEADER_RE = re.compile(
    r'^\[(?P<date>\d{1,2}/\d{1,2}/\d{2,4}),\s(?P<time>\d{1,2}:\d{2}:\d{2}[\s\u202f\u00a0]?[AP]M)\]\s(?P<speaker>[^:]+):\s?(?P<text>.*)$'
)
SYSTEM_RE = re.compile(
    r'^\[(?P<date>\d{1,2}/\d{1,2}/\d{2,4}),\s(?P<time>\d{1,2}:\d{2}:\d{2}[\s\u202f\u00a0]?[AP]M)\]\s(?P<text>.*)$'
)

MEDIA_PATTERNS = [
    re.compile(r'^<attached: .*?>$'),
    re.compile(r'^image omitted$', re.I),
    re.compile(r'^video omitted$', re.I),
    re.compile(r'^audio omitted$', re.I),
    re.compile(r'^document omitted$', re.I),
    re.compile(r'^sticker omitted$', re.I),
    re.compile(r'^GIF omitted$', re.I),
]

BOT_MARKERS = ('[clawdbot]', '[openclaw]')


def is_media_placeholder(text: str) -> bool:
    t = text.strip()
    return any(p.match(t) for p in MEDIA_PATTERNS)


def classify_message(speaker: str | None, text: str):
    stripped = text.strip()
    if speaker is None:
        return 'system'
    if is_media_placeholder(stripped):
        return 'media-placeholder'
    if any(stripped.startswith(m) for m in BOT_MARKERS):
        return 'bot-output'
    return 'chat'


def parse_chat(chat_text: str):
    messages = []
    current = None
    for raw_line in chat_text.splitlines():
        line = raw_line.rstrip('\n')
        m = HEADER_RE.match(line)
        if m:
            if current is not None:
                messages.append(current)
            current = {
                'date': m.group('date'),
                'time': m.group('time').replace('\u202f', ' ').replace('\u00a0', ' '),
                'speaker': m.group('speaker'),
                'text': m.group('text'),
            }
            current['kind'] = classify_message(current['speaker'], current['text'])
            continue
        m2 = SYSTEM_RE.match(line)
        if m2:
            if current is not None:
                messages.append(current)
            current = {
                'date': m2.group('date'),
                'time': m2.group('time').replace('\u202f', ' ').replace('\u00a0', ' '),
                'speaker': None,
                'text': m2.group('text'),
            }
            current['kind'] = classify_message(None, current['text'])
            continue
        if current is None:
            # Orphan line before any header; keep it as a synthetic system line.
            current = {'date': None, 'time': None, 'speaker': None, 'text': line, 'kind': 'system'}
        else:
            current['text'] += '\n' + line
    if current is not None:
        messages.append(current)
    return messages


def main():
    ap = argparse.ArgumentParser(description='Normalize a WhatsApp _chat.txt export into JSONL + summary.')
    ap.add_argument('input', help='Path to _chat.txt')
    ap.add_argument('--outdir', required=True, help='Output directory')
    args = ap.parse_args()

    inp = Path(args.input)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    text = inp.read_text(encoding='utf-8', errors='replace')
    messages = parse_chat(text)

    speakers = Counter((m['speaker'] or 'SYSTEM') for m in messages)
    kinds = Counter(m['kind'] for m in messages)

    jsonl_path = outdir / 'normalized.jsonl'
    with jsonl_path.open('w', encoding='utf-8') as f:
        for idx, m in enumerate(messages, 1):
            row = {'id': idx, **m}
            f.write(json.dumps(row, ensure_ascii=False) + '\n')

    stats = {
        'input': str(inp),
        'message_count': len(messages),
        'speaker_counts': dict(speakers),
        'kind_counts': dict(kinds),
        'first_message': messages[0] if messages else None,
        'last_message': messages[-1] if messages else None,
    }
    (outdir / 'stats.json').write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding='utf-8')
    (outdir / 'stats.txt').write_text(
        '\n'.join([
            f"input: {inp}",
            f"message_count: {len(messages)}",
            'speaker_counts:',
            *[f"  {k}: {v}" for k, v in speakers.most_common()],
            'kind_counts:',
            *[f"  {k}: {v}" for k, v in kinds.most_common()],
        ]),
        encoding='utf-8',
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
