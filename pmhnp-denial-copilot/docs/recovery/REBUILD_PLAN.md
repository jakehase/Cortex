# Rebuild Plan

## Current objective

Move from a still-running but fragile production runtime to a **clean, restart-safe, source-controlled workspace**.

## Done

- Recovered shipped public files from the live deployment
- Captured live probe outputs for the token-gated client routes and API health route
- Created a local dev server that mirrors the visible public/client behavior
- Recorded archived evidence about the Tebra rollout state and onboarding direction

## Next

### Phase 1 — Stabilize the recovered workspace

- [ ] Diff recovered public assets against any other backups/GitHub mirrors that may still surface
- [ ] Decide whether this repo should stay as a standalone workspace or fold into a broader `pmhnpbilling.com` repo
- [x] Add a simple smoke test for `/health`, `/client/session`, and `/client/snapshot`
- [x] Extend smoke coverage through the recovered Tebra onboarding flow in isolated temp state

### Phase 2 — Rebuild the private backend in source form

- [x] Recreate the operational HTTP route structure
- [x] Recreate the token/session layer used by the client portal
- [x] Recreate the snapshot generation path behind `/client/snapshot`
- [x] Recreate the onboarding/Tebra contract routes referenced in archived evidence

### Phase 3 — Rebuild the Tebra attach path safely

- [x] Restore the provider-profile/live-read adapter layer in code (first-pass recovered version)
- [x] Restore fail-closed behavior for incomplete profile/config states
- [x] Add an explicit automation safety spine (policy + approval queue + audit log)
- [x] Keep `live_tebra_oauth=false` until a true end-to-end live path is verified
- [x] Preserve honest pilot messaging while functionality is incomplete

### Phase 4 — Cutover carefully

- [x] Run rebuilt workspace locally on a new port
- [~] Compare live responses against the zombie runtime
  - completed for public unauthenticated auth behavior, invalid-token behavior, `/health`, and forwarded-TLS gate behavior
  - still blocked for successful authenticated `200` client responses without a safe production token/staging equivalent
- [x] Add production-shaped auth/RBAC mode for the recovered backend
- [x] Add backup/restore, preflight, and cutover-check tooling
- [x] Add deployment/cutover runbooks and example service/tunnel wiring
- [~] Capture token/auth behavior before switching production
  - unauthenticated + invalid-token behavior captured
  - signed-token production mode implemented and tested locally
  - valid-token production behavior from the zombie runtime still not captured
- [ ] Only then replace the production process/tunnel wiring

## Important non-goal

Do not restart or redeploy production just because the public site was mirrored. The public surface is the easy part; the risk is in replacing the still-running private backend without reconstructing its source-level behavior first.
