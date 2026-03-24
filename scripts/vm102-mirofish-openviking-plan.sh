#!/usr/bin/env bash
set -euo pipefail
HOST="${1:-10.0.0.52}"
USER_NAME="${2:-root}"
KEY_PATH="${3:-$HOME/.ssh/id_ed25519}"
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$KEY_PATH" "$USER_NAME@$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p /opt/clawdbot/experimental/{mirofish,openviking}
printf "Prepared directories:\n"
find /opt/clawdbot/experimental -maxdepth 2 -type d | sort
cat <<EOF
Next manual steps on VM102:
1. Place MiroFish service assets under /opt/clawdbot/experimental/mirofish
2. Place OpenViking service assets under /opt/clawdbot/experimental/openviking
3. Attach MiroFish to Seer/Simulator via Cortex adapter config
4. Run side-by-side memory eval before any OpenViking cutover
EOF
REMOTE
