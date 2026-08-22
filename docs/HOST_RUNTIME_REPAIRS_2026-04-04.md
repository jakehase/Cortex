# Host Runtime Repairs — 2026-04-04

This note captures machine-level fixes that were required to restore the local Cortex/OpenClaw/Formbricks stack.

## Why this exists

Some of the repair work lives in git-tracked code, but two important changes were applied directly on the host and would be easy to lose during a rebuild:

- the `systemd` unit that keeps Cortex running
- the local Formbricks compose override that fixes its permission crash loop

This file records those host-only changes so they can be replayed intentionally.

## Repo-tracked companion change

The Cortex service starts through this tracked script:

- `public/cortex_server/scripts/start_cortex_service.sh`

That script is versioned in git and is meant to be called by the host service unit below.

## Host-only change 1: Cortex systemd service

Created:

- `/etc/systemd/system/cortex.service`

Installed unit:

```ini
[Unit]
Description=Cortex FastAPI server
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/clawd/public/cortex_server
Environment=PYTHONUNBUFFERED=1
Environment=CORTEX_HOST=0.0.0.0
Environment=CORTEX_PORT=8000
ExecStart=/root/clawd/public/cortex_server/scripts/start_cortex_service.sh
Restart=always
RestartSec=5
TimeoutStartSec=60
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
```

Applied with:

```bash
chmod +x /root/clawd/public/cortex_server/scripts/start_cortex_service.sh
systemctl daemon-reload
systemctl enable --now cortex.service
systemctl restart cortex.service
```

Purpose:

- keep Cortex alive across clean exits and reboots
- make the active service own port `8000`
- stop relying on ad-hoc background `uvicorn` launches

Verification used:

```bash
systemctl status cortex.service --no-pager -n 20
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/orchestrator/runtime/status
```

## Host-only change 2: Formbricks compose override

Updated local file:

- `/opt/formbricks/docker-compose.yml`

Relevant change in service `formbricks`:

```yaml
formbricks:
  restart: always
  image: ghcr.io/formbricks/formbricks:latest
  user: root
  container_name: formbricks
```

Reason:

- the container was crash-looping on permission errors while trying to remove migration files
- running the container as `root` resolved the local permission issue on this host

Applied with:

```bash
cd /opt/formbricks
docker compose up -d formbricks
```

Verification used:

```bash
docker ps --filter name=formbricks
curl http://127.0.0.1:3003
```

## Related git-tracked runtime/plugin fixes

These were fixed in tracked code and committed separately:

- `plugins/cortex-memory-bridge/index.ts`
- `plugins/cortex-memory-bridge/manager.mjs`
- `plugins/cortex-route-gate/index.ts`
- `plugins/outbound-dedupe/index.ts`
- `public/cortex_server/scripts/start_cortex_service.sh`

Those fixes addressed:

- old plugin config falling back to `:18888`
- route gate reading `api.config` instead of `api.pluginConfig`
- memory bridge not registering a real OpenClaw memory runtime
- outbound dedupe depending on a removed SDK helper

## Current intent

After replaying these changes on a fresh machine, the expected state is:

- Cortex managed by `systemd` and listening on `:8000`
- OpenClaw memory shown as available through `plugin cortex-memory-bridge`
- Formbricks running on `:3003` instead of restart-looping
