#!/usr/bin/env bash
set -euo pipefail
HOST="${1:-10.0.0.52}"
USER_NAME="${2:-root}"
KEY_PATH="${3:-$HOME/.ssh/id_ed25519}"
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -i "$KEY_PATH" "$USER_NAME@$HOST" '
set -e
printf "HOSTNAME: "; hostname
printf "USER: "; whoami
printf "CPU: "; nproc
printf "MEM:\n"; free -h
printf "DISK:\n"; df -h /
printf "DOCKER:\n"; command -v docker || true
printf "CLAWDBOT_ROOT:\n"; ls -ld /opt/clawdbot 2>/dev/null || true
'
