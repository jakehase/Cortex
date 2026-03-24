# Cutover Runbook

This project still has a **zombie runtime** serving production traffic from a missing/deleted source tree. Treat cutover as a controlled replacement, not a normal restart.

## Goal

Replace the zombie runtime with the recovered source workspace **without losing the working service**.

## Preconditions

- production env file exists and passes `npm run preflight:prod`
- `npm run smoke` passes
- `npm run cutover:check` passes
- a fresh state backup exists from the target machine
- replacement process can start on a non-production test port first
- tunnel/service config is ready before touching the zombie runtime

## Recommended dry run

Before cutover, run the recovered app on a second port with production flags:

```bash
PORT=18088 \
PMHNP_REQUIRE_FORWARDED_TLS=true \
PMHNP_ENFORCE_OPERATIONAL_AUTH=true \
PMHNP_REQUIRE_ACTOR_HEADERS=true \
PMHNP_MINIMAL_HEALTH_RESPONSE=true \
PMHNP_ALLOW_LEGACY_STATIC_TOKENS=false \
npm start
```

Then verify locally through a proxy/header-aware probe:

- `/health` → `{"ok":true}`
- `/client/session` without `x-forwarded-proto=https` → `403 OPERATIONAL_API_TLS_REQUIRED`
- `/client/session` with forwarded TLS but no token → `401 CLIENT_PORTAL_AUTH_REQUIRED`
- `/v1/auth/client/login` with forwarded TLS → signed token issuance succeeds
- `/v1/auth/ops/login` with forwarded TLS → reviewer/admin token issuance succeeds

## Cutover steps

1. **Backup current state**
   - run `npm run backup:state`
   - record the backup directory
2. **Record zombie runtime facts**
   - confirm port `18087` is serving
   - confirm current public `/health` still returns `{"ok":true}`
3. **Prepare new service files**
   - systemd unit/env file
   - cloudflared config
4. **Start recovered server on alternate port**
   - verify strict mode works before changing traffic
5. **Switch runtime**
   - stop or detach the zombie process only when the new service can start immediately
   - start the recovered service on the real port
6. **Switch edge/tunnel**
   - point Cloudflare tunnel/ingress to the recovered service if needed
7. **Post-cutover validation**
   - public `/health`
   - public `/client/session` unauthenticated
   - public `/client/snapshot` unauthenticated
   - signed login issuance
   - reviewer approval queue load
   - admin audit access
8. **Observe**
   - keep rollback artifacts available
   - do not delete zombie evidence until the new runtime has been stable long enough

## Rollback

Rollback plan must be ready before cutover:

1. stop the recovered service
2. restore prior tunnel/service target
3. if state was mutated incorrectly, restore the last known good backup with `npm run restore:state -- <backup-dir> --force`
4. re-validate the public surfaces

## Known remaining reality check

Even after this code hardening, true production readiness still depends on:

- correct secrets
- real deployment wiring
- monitored service health
- supervised first cutover

Code can be production-shaped. Cutover is still an operations task.
