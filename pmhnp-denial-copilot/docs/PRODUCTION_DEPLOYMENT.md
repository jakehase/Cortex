# Production Deployment

This repo is now capable of running in a production-shaped mode, but **production safety still depends on environment, secrets, and cutover discipline**.

## Required production posture

Set these flags in production:

```bash
PMHNP_REQUIRE_FORWARDED_TLS=true
PMHNP_ENFORCE_OPERATIONAL_AUTH=true
PMHNP_REQUIRE_ACTOR_HEADERS=true
PMHNP_MINIMAL_HEALTH_RESPONSE=true
PMHNP_ALLOW_LEGACY_STATIC_TOKENS=false
```

## Required secrets

Do not use repo defaults.

- `PMHNP_TOKEN_SIGNING_SECRET`
- `PMHNP_CLIENT_LOGIN_KEY`
- `PMHNP_REVIEWER_LOGIN_KEY`
- `PMHNP_ADMIN_LOGIN_KEY`

Optional break-glass only:

- `PMHNP_CLIENT_PORTAL_TOKEN`
- `PMHNP_OPERATIONAL_API_TOKEN`

If break-glass tokens are used, keep legacy mode disabled by default and only enable it during a supervised incident.

## Recommended filesystem layout

```text
/opt/pmhnp-denial-copilot          # checked-out app code
/var/lib/pmhnp/state               # runtime state
/var/lib/pmhnp/backups             # backups
/etc/pmhnp/pmhnp.env               # protected environment file
/etc/cloudflared/...               # tunnel config/credentials
```

## Preflight

Run before any production deployment or cutover:

```bash
cd /opt/pmhnp-denial-copilot
npm run preflight:prod
npm run smoke
npm run cutover:check
```

Expected results:

- preflight passes with no failures
- smoke passes
- cutover check passes for:
  - live public 401/health expectations
  - zombie TLS gate expectation
  - recovered strict mode expectations

## Service wiring

Example files in repo:

- `deploy/systemd/pmhnp-denial-copilot.service.example`
- `deploy/cloudflared/config.example.yml`
- `.env.production.example`

These are examples only. Keep real secrets and real tunnel credentials outside the repo.

## Backup / restore

Create a state backup:

```bash
npm run backup:state
```

Restore from a backup directory:

```bash
npm run restore:state -- state-backup-YYYY-MM-DDTHH-MM-SS-Z --force
```

The restore script creates a safety backup of the current state before replacement.

## Deployment order

1. Place repo code in target path.
2. Install/verify Node runtime.
3. Write secure env file with production values.
4. Run `npm run preflight:prod`.
5. Run `npm run smoke`.
6. Run `npm run cutover:check`.
7. Create a fresh state backup.
8. Stop old process/tunnel only when replacement is ready to start immediately.
9. Start new process.
10. Re-point or restart tunnel/service wiring.
11. Validate `/health`, `/client/session`, `/client/snapshot`, login routes, and approval queue.
12. Keep zombie runtime rollback path available until new runtime is verified.
