#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/clawdbot}"
REMOTE_ROOT="${CORTEX_REMOTE_ROOT:-/opt/clawdbot}"
REMOTE="${CORTEX_VM:-}"
REMOTE_FILE="${CORTEX_VM_FILE:-$REPO_ROOT/.sync-runtime/cortex_vm}"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage:
  pull_from_cortex_vm.sh [--dry-run]

Syncs the public-safe Cortex code surface from the canonical VM host tree into the
local source tree before public export.

Remote selection is read from:
  1) CORTEX_VM env var
  2) .sync-runtime/cortex_vm (single line like jake@10.0.0.52)

Managed surface:
  - cortex_server/cortex_server/**/*.py
  - cortex_server/tests/**/*.py
  - cortex_server/scripts/**/*.py
  - cortex_server/{README.md,requirements.txt,requirements.lock.txt,run.py,scheduler.py,worker.py}
  - benchmarks/{replay_regression_suite.py,replay_enforced_seed.jsonl}

Notes:
  - secret-bearing deploy files (e.g. docker-compose/.env) are intentionally NOT synced
  - deletions are applied only within the managed surface
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$REMOTE" && -f "$REMOTE_FILE" ]]; then
  REMOTE="$(tr -d '\r\n' < "$REMOTE_FILE")"
fi

if [[ -z "$REMOTE" ]]; then
  echo "canonical_pull_skipped reason=no_remote_config"
  exit 0
fi

mkdir -p "$REPO_ROOT/.sync-runtime"
remote_manifest="$REPO_ROOT/.sync-runtime/canonical_vm_remote_manifest.txt"
local_manifest="$REPO_ROOT/.sync-runtime/canonical_vm_local_manifest.txt"

ssh_base=(ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$REMOTE")

remote_script=$(cat <<'PY'
from pathlib import Path
root = Path("/opt/clawdbot")
paths = set()


def add_tree(base_rel: str):
    base = root / base_rel
    if not base.exists():
        return
    for p in base.rglob('*.py'):
        rel = p.relative_to(root)
        if '__pycache__' in rel.parts:
            continue
        name = p.name
        if '.bak' in name or name.endswith('.pyc') or name.endswith('_tmp.py'):
            continue
        paths.add(rel.as_posix())


def add_file(rel: str):
    p = root / rel
    if p.is_file():
        paths.add(rel)

for tree in [
    'cortex_server/cortex_server',
    'cortex_server/tests',
    'cortex_server/scripts',
]:
    add_tree(tree)

for rel in [
    'cortex_server/README.md',
    'cortex_server/requirements.txt',
    'cortex_server/requirements.lock.txt',
    'cortex_server/run.py',
    'cortex_server/scheduler.py',
    'cortex_server/worker.py',
    'benchmarks/replay_regression_suite.py',
    'benchmarks/replay_enforced_seed.jsonl',
]:
    add_file(rel)

for item in sorted(paths):
    print(item)
PY
)

"${ssh_base[@]}" "cd '$REMOTE_ROOT' && python3 - <<'PY'
$remote_script
PY" > "$remote_manifest"

python3 - <<'PY' > "$local_manifest"
from pathlib import Path
root = Path('/opt/clawdbot')
paths = set()

def add_tree(base_rel: str):
    base = root / base_rel
    if not base.exists():
        return
    for p in base.rglob('*.py'):
        rel = p.relative_to(root)
        if '__pycache__' in rel.parts:
            continue
        name = p.name
        if '.bak' in name or name.endswith('.pyc') or name.endswith('_tmp.py'):
            continue
        paths.add(rel.as_posix())

def add_file(rel: str):
    p = root / rel
    if p.is_file():
        paths.add(rel)

for tree in [
    'cortex_server/cortex_server',
    'cortex_server/tests',
    'cortex_server/scripts',
]:
    add_tree(tree)

for rel in [
    'cortex_server/README.md',
    'cortex_server/requirements.txt',
    'cortex_server/requirements.lock.txt',
    'cortex_server/run.py',
    'cortex_server/scheduler.py',
    'cortex_server/worker.py',
    'benchmarks/replay_regression_suite.py',
    'benchmarks/replay_enforced_seed.jsonl',
]:
    add_file(rel)

for item in sorted(paths):
    print(item)
PY

python3 - <<'PY'
from pathlib import Path
remote = set(Path('/opt/clawdbot/.sync-runtime/canonical_vm_remote_manifest.txt').read_text().splitlines())
local = set(Path('/opt/clawdbot/.sync-runtime/canonical_vm_local_manifest.txt').read_text().splitlines())
only_remote = sorted(x for x in remote - local if x)
only_local = sorted(x for x in local - remote if x)
common = sorted(x for x in remote & local if x)
print(f'canonical_pull_remote_count={len(remote)} local_count={len(local)} add_or_update_candidates={len(only_remote) + len(common)} delete_candidates={len(only_local)}')
print('canonical_pull_remote_only_sample=' + ', '.join(only_remote[:12]))
print('canonical_pull_local_only_sample=' + ', '.join(only_local[:12]))
PY

if (( DRY_RUN == 1 )); then
  echo "canonical_pull_dry_run_manifest=$remote_manifest"
  exit 0
fi

if [[ -s "$remote_manifest" ]]; then
  tar_cmd="cd '$REMOTE_ROOT' && tar -czf - -T -"
  "${ssh_base[@]}" "$tar_cmd" < "$remote_manifest" | tar -xzf - -C "$REPO_ROOT"
fi

python3 - <<'PY'
from pathlib import Path
root = Path('/opt/clawdbot')
remote = set(Path('/opt/clawdbot/.sync-runtime/canonical_vm_remote_manifest.txt').read_text().splitlines())
local = set(Path('/opt/clawdbot/.sync-runtime/canonical_vm_local_manifest.txt').read_text().splitlines())
removed = 0
for rel in sorted(x for x in local - remote if x):
    p = root / rel
    if p.exists():
        p.unlink()
        removed += 1
print(f'canonical_pull_removed={removed}')
PY

echo "canonical_pull_complete remote=$REMOTE manifest=$remote_manifest"
