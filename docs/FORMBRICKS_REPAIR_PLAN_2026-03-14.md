# Formbricks / intake.pmhnpbilling.com repair plan — 2026-03-14

## What this service was supposed to do
Historical transcript evidence shows this host’s Formbricks instance was the self-hosted PMHNP Billing client intake portal:
- intended public URL: `https://intake.pmhnpbilling.com`
- expected use: published **link/email survey** for client onboarding, embedded or linked from `pmhnpbilling.com`
- expected user-visible behavior: branded intake form, publishable/editable in UI, no Formbricks branding, reachable externally via the intake subdomain
- it was working earlier (`HTTP 200`, local `:3003`, then routed to `intake.pmhnpbilling.com`) and later began returning upstream failure / 502

## Current failure
The `formbricks` container is in a restart loop. `formbricks-db` and `formbricks-redis` are up.

Primary crash evidence from `docker logs formbricks`:
- startup runs `node ./dist/scripts/apply-migrations.js`
- that script executes `rm -rf /home/nextjs/packages/database/migrations/*`
- it fails on every file with `Permission denied`
- container user is `nextjs` (`docker inspect ... .Config.User`)

This is **not** a Postgres connectivity failure despite the wrapper message. Database is readable and already initialized:
- `_prisma_migrations` row count: `130`
- public tables exist (`Account`, `Project`, `Response`, etc.)

## Most likely root cause
Most likely a **Formbricks image/startup regression combined with stale container writable-layer ownership**:
- deployment is pinned to mutable `ghcr.io/formbricks/formbricks:latest`
- the current startup path tries to wipe `/home/nextjs/packages/database/migrations/*`
- that path is **inside the container filesystem**, not a declared Docker volume in compose
- the running container uses user `nextjs`, but the migration files now present there are not deletable by that user

Why this points to container-layer/image state rather than application data corruption:
- compose only declares persistent app mounts for:
  - `/home/nextjs/apps/web/saml-connection`
  - `/home/nextjs/apps/web/uploads`
- the crashing path `/home/nextjs/packages/database/migrations` is **not** one of those mounts
- Postgres data is intact and already migrated
- this matches the earlier transcript note: “same migration bug ... issue with the latest Formbricks image”

## Files / volumes involved
### Deployment file
- `/opt/formbricks/docker-compose.yml`

### Runtime config of interest
From compose:
- image: `ghcr.io/formbricks/formbricks:latest`
- public URL envs:
  - `WEBAPP_URL=https://intake.pmhnpbilling.com`
  - `NEXTAUTH_URL=https://intake.pmhnpbilling.com`
- DB:
  - `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/formbricks?schema=public`

### Persistent volumes that should be preserved
- `formbricks_postgres` → `/var/lib/postgresql/data`
- `formbricks_redis` → `/data`
- `2fce3d2c206d495b9cd7269f74fb20fcc55b90f81a1e5b8e295a44cf730ec6ed` → `/home/nextjs/apps/web/saml-connection`
- `589a555cc5a35108061fb3992c0e9dac98cc61bbe4972b1799ee45c9b583b5a1` → `/home/nextjs/apps/web/uploads`

### Non-persistent crash path
- `/home/nextjs/packages/database/migrations/*` inside the `formbricks` container writable layer

## Minimal-risk remediation
1. **Back up compose + volume metadata first**
   - copy `/opt/formbricks/docker-compose.yml`
   - record `docker inspect formbricks`, `docker volume inspect ...`, and current image digest/ID

2. **Preserve Postgres and uploads; do not delete named volumes**
   - keep `formbricks_postgres`
   - keep `formbricks_redis`
   - keep the `uploads` and `saml-connection` volumes

3. **Recreate only the app container**
   - remove/recreate `formbricks` container so its writable layer is discarded
   - this is the lowest-risk repair because the failing path is inside the app container layer, not the DB volume

4. **Prefer pinning away from `latest` before recreating**
   - safest operational move is to change `/opt/formbricks/docker-compose.yml` from `ghcr.io/formbricks/formbricks:latest` to the last known-good Formbricks tag/digest used before the regression
   - if no exact prior tag is known, recreate once with the current image only after capturing rollback info; but pinning is strongly preferred to avoid re-pulling the same bad startup behavior later

5. **After app container recreation, verify in this order**
   - container stays up
   - local health/UI on `http://host:3003`
   - survey editor loads and existing survey/project data is present
   - public route `https://intake.pmhnpbilling.com` works again

## Rollback precautions
- **Do not prune volumes/images blindly**
- **Do not delete `formbricks_postgres`**; that is the real data
- if recreating the app container does not resolve it, revert to the previously known-good image tag/digest while keeping the same DB/uploads volumes
- because the DB already contains newer migrations, rolling back too far may create app/schema incompatibility; choose the nearest known-good Formbricks version, not an arbitrarily old one
- if a downgrade is attempted, snapshot the Postgres volume first

## Practical repair hypothesis
Most likely successful repair path:
- pin Formbricks to a known-good non-`latest` image
- recreate **only** the `formbricks` application container
- reuse existing Postgres/Redis/uploads/SAML volumes

That should address the current crash loop without destructive changes to intake data or survey content.