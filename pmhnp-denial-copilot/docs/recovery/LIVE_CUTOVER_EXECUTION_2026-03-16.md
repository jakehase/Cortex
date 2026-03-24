# Live Cutover Execution — 2026-03-16

This note records what was actually executed on the host during the first live replacement of the PMHNP zombie runtime.

## What was replaced

The old runtime serving port `18087` was a detached/zombie process launched from a missing working tree under:

- `/root/.openclaw/workspace/pmhnp-denial-copilot`

Observed old process chain before replacement:

- Node runtime on `0.0.0.0:18087`
- parented via a long-lived shell / PM2 daemon rather than a clean systemd app unit

## Recovered environment facts discovered during cutover

Environment visible from the live process showed real production-style paths:

- `PMHNP_STATE_DIR=/var/lib/pmhnp-operational/state`
- `PMHNP_CLIENT_PORTAL_ACCOUNT_STORE=/var/lib/pmhnp-operational/client-accounts.json`
- `PMHNP_GUARD_STATE_FILE=/var/lib/pmhnp-operational/operational-guard-state.json`
- `PMHNP_CLIENT_PORTAL_TOKEN_SECRET=file:/etc/pmhnp/secrets/client-portal-token-secret`
- `PMHNP_OPERATIONAL_AUTH_SHARED_SECRET=file:/etc/pmhnp/secrets/operational-auth-shared-secret`
- `PMHNP_OPERATIONAL_HTTP_PORT=18087`
- `PMHNP_OPERATIONAL_AUTH_REQUIRE_TLS=true`

At cutover time, those referenced files were not cleanly present on disk anymore, so the recovered runtime was staged with a fresh env + secret set.

## Actions performed

### 1. Staged the recovered app into the live path

Copied the reconstructed repo into:

- `/root/.openclaw/workspace/pmhnp-denial-copilot`

### 2. Created production env + state directories

Created:

- `/etc/pmhnp/pmhnp.env`
- `/etc/pmhnp/secrets/`
- `/var/lib/pmhnp-operational/state`
- `/var/lib/pmhnp-operational/backups`
- `/var/lib/pmhnp-operational/logs`
- `/var/lib/pmhnp-operational/run`

### 3. Installed operational helper scripts

Installed host scripts:

- `/usr/local/bin/pmhnp-prod-start`
- `/usr/local/bin/pmhnp-prod-stop`
- `/usr/local/bin/pmhnp-prod-status`
- `/usr/local/bin/pmhnp-cloudflared-start`
- `/usr/local/bin/pmhnp-cloudflared-status`

### 4. Ran production preflight and staging verification

Validated the recovered app on alternate port `18088` before switching live traffic.

### 5. Backed up current state and replaced the live process

Created a backup under:

- `/var/lib/pmhnp-operational/backups/state-backup-2026-03-16T16-54-45-060Z`

Then stopped the zombie runtime and started the recovered app on port `18087`.

### 6. Switched the app to real systemd ownership

Installed and enabled:

- `/etc/systemd/system/pmhnp-denial-copilot.service`

Verified:

- `systemctl restart pmhnp-denial-copilot.service` succeeds
- local strict-mode checks still succeed after restart

### 7. Fixed startup secret logging

Updated the app CLI so startup logs redact configured tokens instead of printing them.

## Public verification after cutover

Verified after replacement:

- `https://api.pmhnpbilling.com/health` → `{"ok":true}`
- `https://pmhnpbilling.com/client/session` → `401 CLIENT_PORTAL_AUTH_REQUIRED`
- `https://pmhnpbilling.com/client/snapshot` → `401 CLIENT_PORTAL_AUTH_REQUIRED`

## Tunnel / edge findings

Cloudflared ownership was more complicated than the app runtime.

Observed processes:

- a `cloudflared --config /etc/cloudflared/config.yml run --token ...` process owned by uid `65532`
- a PM2-managed `/usr/local/bin/cloudflared tunnel run --token-file /etc/pmhnp/secrets/pmhnp-named-tunnel-token --url http://127.0.0.1:18087`

Recovered config visible through `/proc/967/root/etc/cloudflared/config.yml` showed:

- named tunnel `d26ff1ed-f670-473a-bef2-9ff081774e87`
- ingress:
  - `intake.pmhnpbilling.com` → `http://formbricks:3000`
  - fallback `http_status:404`

This means the tunnel topology for public PMHNP API/app routes is still at least partially mediated elsewhere (likely Cloudflare edge/worker/origin config outside this repo), even though the recovered app is now the live backend on `18087`.

## Current resulting state

### Completed

- recovered PMHNP backend is live on `18087`
- app runtime is now systemd-managed and restart-safe
- public health and unauthenticated client auth gates still behave correctly

### Remaining uncertainty

- exact ownership path for every Cloudflare edge route (`api.pmhnpbilling.com`, `pmhnpbilling.com/client/*`) is not yet fully mapped from inside this container
- cloudflared persistence is improved, but the public PMHNP edge path is not as cleanly attributable as the app service itself

## Honest conclusion

The highest-risk problem is solved:

- the deleted-source zombie Node runtime has been replaced by the recovered source-controlled app
- the app itself is now restart-safe under systemd

The remaining work is edge/tunnel attribution cleanup, not core backend survivability.
