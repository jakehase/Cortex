#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="${1:-/root/clawd}"
EXPORT_ROOT="${EXPORT_ROOT:-/root/clawd/.cortex-export}"
REMOTE="${GIT_REMOTE:-origin}"
BRANCH="${GIT_BRANCH:-openclaw-sync}"
COMMIT_PREFIX="${COMMIT_PREFIX:-cortex:}"
REMOTE_URL="${REMOTE_URL:-https://github.com/jakehase/Cortex.git}"
GITHUB_PUSH_WRAPPER="${GITHUB_PUSH_WRAPPER:-/root/.local/bin/openclaw-safe-github-push}"

CORTEX_PATHS=(
  "plugins/cortex-route-gate"
  "plugins/cortex-memory-bridge"
  "plugins/cortex-browser-bridge"
  "plugins/cortex-principal-identity.mjs"
  "plugins/cortex-principal-parity.test.mjs"
  "scripts/cortex-upgrade-selftest.mjs"
  "scripts/cortex-capability-preflight.mjs"
  "scripts/cortex-capability-probe.mjs"
  "state/cortex-capabilities.json"
  "state/cortex-self-model.json"
  "state/cortex-contradictions.json"
  "state/completion-integrity"
  "scripts/cortex-self-model-report.mjs"
  "docs/CORTEX_*.md"
  "docs/cortex_*"
)

mkdir -p "$EXPORT_ROOT"
cd "$EXPORT_ROOT"
if [[ ! -d .git ]]; then
  git init -q
  git config user.name "OpenClaw"
  git config user.email "openclaw@local"
  git remote add "$REMOTE" "$REMOTE_URL"
fi

# Clear tracked export content except .git
find "$EXPORT_ROOT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

cd "$SRC_ROOT"
shopt -s nullglob globstar
for pattern in "${CORTEX_PATHS[@]}"; do
  for path in $pattern; do
    [[ -e "$path" ]] || continue
    mkdir -p "$EXPORT_ROOT/$(dirname "$path")"
    if [[ -d "$path" ]]; then
      rm -rf "$EXPORT_ROOT/$path"
      mkdir -p "$EXPORT_ROOT/$path"
      cp -a "$path"/. "$EXPORT_ROOT/$path"/
    else
      cp -f "$path" "$EXPORT_ROOT/$path"
    fi
  done
done

cd "$EXPORT_ROOT"
# lightweight provenance (stable; do not include timestamps or other always-changing fields)
cat > EXPORT_MANIFEST.txt <<EOF
source_repo: $SRC_ROOT
branch: $BRANCH
remote_url: $REMOTE_URL
EOF

git add .
if git diff --cached --quiet; then
  echo "no cortex-scoped export changes"
  exit 0
fi

msg="${COMMIT_PREFIX} $(date +%F' '%T) auto-save cortex export"
git commit -m "$msg" >/dev/null

if [[ -x "$GITHUB_PUSH_WRAPPER" ]]; then
  "$GITHUB_PUSH_WRAPPER" --repo "$EXPORT_ROOT" -u "$REMOTE" "HEAD:$BRANCH"
else
  git push -u "$REMOTE" "HEAD:$BRANCH"
fi
echo "pushed clean cortex export to $REMOTE_URL ($BRANCH)"
