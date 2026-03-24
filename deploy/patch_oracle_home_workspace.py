import json

paths = [
    '/root/clawd/deploy/oracle-openclaw-home/openclaw.json',
    '/root/clawd/deploy/oracle-openclaw-home/.openclaw/openclaw.json',
]
for p in paths:
    with open(p) as f:
        obj = json.load(f)
    obj.setdefault('agents', {}).setdefault('defaults', {})['workspace'] = '/root/clawd/deploy/oracle-workspace-lite'
    with open(p, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')
print('patched oracle home configs')
