#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SNAP_TS="$(date -u +%Y%m%dT%H%M%SZ)-$$"
SNAP_DIR="/root/recovery/ct101-snapshot-${SNAP_TS}"
LOG_FILE="${SNAP_DIR}/snapshot.log"
IMAGE_TAG="ct101-snapshot:gladys-clawdbot-${SNAP_TS}"

mkdir -p "$SNAP_DIR" "$SNAP_DIR/metadata" "$SNAP_DIR/docker" "$SNAP_DIR/host-tars" "$SNAP_DIR/files"

log(){
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

run_to_file(){
  local outfile="$1"
  shift
  log "Running: $*"
  "$@" >"$outfile" 2>&1
}

save_text(){
  local outfile="$1"
  shift
  log "Running shell capture: $*"
  bash -lc "$*" >"$outfile" 2>&1
}

require_cmd(){
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd docker
require_cmd tar
require_cmd gzip
require_cmd sha256sum
require_cmd openclaw

log "Creating CT101 snapshot at $SNAP_DIR"

# Basic host/service metadata
save_text "$SNAP_DIR/metadata/df.txt" "df -h / /root /opt /var/lib/docker 2>/dev/null"
save_text "$SNAP_DIR/metadata/du.txt" "du -sh /opt/clawdbot /opt/formbricks /root/observability /root/.openclaw 2>/dev/null"
save_text "$SNAP_DIR/metadata/uname.txt" "uname -a"
save_text "$SNAP_DIR/metadata/date.txt" "date --iso-8601=seconds && date -u --iso-8601=seconds"
save_text "$SNAP_DIR/metadata/openclaw-gateway-status.txt" "openclaw gateway status"
save_text "$SNAP_DIR/metadata/openclaw-status.txt" "openclaw status"
save_text "$SNAP_DIR/metadata/loginctl-root.txt" "loginctl show-user root -p Linger 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/root-crontab.txt" "crontab -l 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/system-cron-grep.txt" "grep -RInE 'observability|openclaw|pm2|clawdbot|cortex|docker compose|docker restart' /etc/cron* /var/spool/cron 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/systemctl-user-openclaw.txt" "systemctl --user cat openclaw-gateway.service 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/systemctl-user-relevant.txt" "systemctl --user list-unit-files --no-pager 2>/dev/null | egrep -i 'openclaw|pm2|claw|cortex' || true"
save_text "$SNAP_DIR/metadata/systemctl-cortex-effective-properties.txt" "systemctl show cortex.service --no-pager -p Id -p LoadState -p ActiveState -p SubState -p FragmentPath -p DropInPaths -p Restart -p RestartUSec -p MemoryCurrent -p MemoryHigh -p MemoryMax -p MemorySwapMax -p TasksCurrent -p TasksMax -p OOMPolicy 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/systemctl-cortex-effective-unit.txt" "systemctl cat cortex.service --no-pager 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/systemctl-cortex-relevant-timers.txt" "systemctl list-timers --all --no-pager 2>/dev/null | egrep -i 'cortex|health|watchdog' || true"
save_text "$SNAP_DIR/metadata/systemctl-cortex-timer-properties.txt" 'for unit in $(systemctl list-unit-files --type=timer --no-legend --no-pager 2>/dev/null | awk "{print \$1}" | egrep -i "cortex|health|watchdog"); do printf "[%s]\n" "$unit"; systemctl show "$unit" --no-pager -p Id -p LoadState -p ActiveState -p SubState -p Unit -p NextElapseUSecRealtime -p LastTriggerUSec -p Persistent -p AccuracyUSec -p RandomizedDelayUSec -p FragmentPath -p DropInPaths; systemctl cat "$unit" --no-pager; done 2>/dev/null || true'

# Docker metadata
save_text "$SNAP_DIR/metadata/docker-ps-a.txt" "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.RunningFor}}'"
save_text "$SNAP_DIR/metadata/docker-compose-ls.txt" "docker compose ls 2>/dev/null || true"
save_text "$SNAP_DIR/metadata/docker-network-ls.txt" "docker network ls"
save_text "$SNAP_DIR/metadata/docker-volume-ls.txt" "docker volume ls"
save_text "$SNAP_DIR/metadata/docker-inspect-all.json" 'ids=$(docker ps -aq); if [ -n "$ids" ]; then docker inspect $ids; else echo "[]"; fi'
save_text "$SNAP_DIR/metadata/docker-container-restart-policies.txt" 'for c in $(docker ps -aq); do docker inspect --format "{{.Name}} | restart={{.HostConfig.RestartPolicy.Name}} | status={{.State.Status}} | image={{.Config.Image}}" "$c"; done | sed "s#^/##"'

# Current host config files / directories (sensitive)
log "Copying host config files"
mkdir -p "$SNAP_DIR/files/root-config-systemd-user"
cp -a /root/.config/systemd/user/. "$SNAP_DIR/files/root-config-systemd-user/" 2>/dev/null || true
cp -a /opt/clawdbot "$SNAP_DIR/files/" 2>/dev/null || true
cp -a /opt/formbricks "$SNAP_DIR/files/" 2>/dev/null || true
cp -a /root/observability "$SNAP_DIR/files/" 2>/dev/null || true

# Tarballs of key host dirs for portable recovery
log "Archiving key host directories"
tar -C /opt -czf "$SNAP_DIR/host-tars/opt-clawdbot.tar.gz" clawdbot
tar -C /opt -czf "$SNAP_DIR/host-tars/opt-formbricks.tar.gz" formbricks 2>/dev/null || true
tar -C /root -czf "$SNAP_DIR/host-tars/root-observability.tar.gz" observability 2>/dev/null || true

# Fresh official OpenClaw safety backup at snapshot time
log "Creating fresh official verified OpenClaw backup"
openclaw backup create --verify --output "$SNAP_DIR" --json >"$SNAP_DIR/metadata/openclaw-backup-create.json"

# Legacy container metadata
log "Capturing gladys-clawdbot metadata"
save_text "$SNAP_DIR/docker/gladys-clawdbot-inspect.json" "docker inspect gladys-clawdbot"
save_text "$SNAP_DIR/docker/gladys-clawdbot-top.txt" "docker top gladys-clawdbot -eo pid,ppid,comm,args || docker top gladys-clawdbot"
save_text "$SNAP_DIR/docker/gladys-clawdbot-logs-tail.txt" "docker logs --tail 1000 gladys-clawdbot 2>&1 || true"
save_text "$SNAP_DIR/docker/gladys-clawdbot-processes.txt" "docker exec gladys-clawdbot ps -eo pid,ppid,args 2>/dev/null || true"
save_text "$SNAP_DIR/docker/gladys-clawdbot-paths.txt" 'docker exec gladys-clawdbot sh -c "for p in /root/.clawdbot /root/.openclaw /root/.pm2 /root/.bashrc /root/.profile /root/clawd /root/cortex_server /etc/pmhnp /opt/clawdbot/sync /usr/local/bin/cloudflared; do echo --- $p ---; ls -la $p 2>/dev/null || true; done" 2>/dev/null || true'

# Container snapshot: best-effort engine-level image/export plus direct in-container tar capture.
# --pause=false avoids even brief process interruption in the fragile legacy container.
log "Attempting engine-level commit of gladys-clawdbot to image $IMAGE_TAG"
if docker commit --pause=false --author 'OpenClaw' --message "CT101 snapshot ${SNAP_TS}" gladys-clawdbot "$IMAGE_TAG" >"$SNAP_DIR/docker/gladys-clawdbot-commit.txt" 2>"$SNAP_DIR/docker/gladys-clawdbot-commit.err"; then
  save_text "$SNAP_DIR/docker/gladys-clawdbot-image-inspect.json" "docker image inspect '$IMAGE_TAG'"
  log "Saving committed image tarball"
  if ! docker save "$IMAGE_TAG" | gzip -1 >"$SNAP_DIR/docker/gladys-clawdbot-image.tar.gz"; then
    log "Warning: docker save failed; see docker/gladys-clawdbot-commit.err and engine logs"
  fi
else
  log "Warning: docker commit failed; see docker/gladys-clawdbot-commit.err"
fi

log "Attempting full container filesystem export"
if ! docker export gladys-clawdbot | gzip -1 >"$SNAP_DIR/docker/gladys-clawdbot-rootfs.tar.gz"; then
  log "Warning: docker export failed; continuing with targeted in-container tar capture"
  rm -f "$SNAP_DIR/docker/gladys-clawdbot-rootfs.tar.gz"
fi

log "Capturing targeted in-container paths via tar stream"
docker exec gladys-clawdbot sh -c 'tar -cf - \
  /root/.clawdbot \
  /root/.openclaw \
  /root/.pm2 \
  /root/.bashrc \
  /root/.profile \
  /root/clawd \
  /root/cortex_server \
  /etc/pmhnp \
  /opt/clawdbot/sync \
  /usr/local/bin/cloudflared \
  2>/dev/null || true' | gzip -1 >"$SNAP_DIR/docker/gladys-clawdbot-targeted-paths.tar.gz"

# Checksums and manifest
log "Writing manifest and checksums"
cat >"$SNAP_DIR/README.txt" <<EOF
CT101 snapshot created at: $(date -u --iso-8601=seconds)
Snapshot directory: $SNAP_DIR
Committed image tag: $IMAGE_TAG
Contents:
- metadata/: host, service, Docker, and OpenClaw state captures
- files/: copied host config directories (sensitive)
- host-tars/: tarballs of key host dirs
- docker/: legacy container inspect/log/process captures + committed image/rootfs exports
- official OpenClaw backup archive created during this run

This snapshot contains secrets and credentials. Handle locally only.
EOF

(
  cd "$SNAP_DIR"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

log "Snapshot complete: $SNAP_DIR"
