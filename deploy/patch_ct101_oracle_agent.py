import json
import shutil

p = '/root/.openclaw/openclaw.json'
with open(p) as f:
    obj = json.load(f)

agents = obj.setdefault('agents', {})
agents.setdefault('defaults', {})
entries = agents.setdefault('list', [])

main = next((e for e in entries if isinstance(e, dict) and e.get('id') == 'main'), None)
if main is None:
    main = {'id': 'main'}
    entries.insert(0, main)
main['default'] = True

oracle = next((e for e in entries if isinstance(e, dict) and e.get('id') == 'oracle'), None)
if oracle is None:
    oracle = {'id': 'oracle'}
    entries.append(oracle)
oracle['name'] = 'Oracle Bridge'
oracle['workspace'] = '/root/clawd/deploy/oracle-workspace-lite'

for entry in entries:
    if isinstance(entry, dict) and entry.get('id') != 'main' and entry.get('default') is True:
        entry.pop('default', None)

shutil.copy2(p, p + '.bak-oracle-agent')
with open(p, 'w') as f:
    json.dump(obj, f, indent=2)
    f.write('\n')

print('patched', p)
print(json.dumps(obj['agents'], indent=2))
