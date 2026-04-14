#!/usr/bin/env bash
set -euo pipefail

PACKAGE_DIR="/usr/lib/node_modules/openclaw"
DIST_DIR="$PACKAGE_DIR/dist"
INSTALLED_VERSION="$(node -p "require('/usr/lib/node_modules/openclaw/package.json').version")"

case "$INSTALLED_VERSION" in
  2026.4.14)
    STAGING_DIR="/root/clawd/_staging/openclaw-2026.4.14/extracted/dist"
    cp -f "$STAGING_DIR/subagent-spawn-EVVOmnQJ.js" "$DIST_DIR/subagent-spawn-EVVOmnQJ.js"
    cp -f "$STAGING_DIR/model-context-tokens-CwcLB3PA.js" "$DIST_DIR/model-context-tokens-CwcLB3PA.js"
    ;;
  *)
    echo "Unsupported OpenClaw version for local patch reapply: $INSTALLED_VERSION" >&2
    exit 2
    ;;
esac

echo "Reapplied local OpenClaw patches for version $INSTALLED_VERSION"
