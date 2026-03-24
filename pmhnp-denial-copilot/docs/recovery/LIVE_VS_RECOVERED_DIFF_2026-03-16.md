# Live vs Recovered Diff — 2026-03-16

This report compares the still-running **zombie production runtime** with the reconstructed workspace running locally from source.

## Compared surfaces

### Live public edge

- `https://pmhnpbilling.com/client/session`
- `https://pmhnpbilling.com/client/snapshot`
- `https://api.pmhnpbilling.com/health`

### Live internal runtime

- `http://127.0.0.1:18087/client/session`
- `http://127.0.0.1:18087/client/snapshot`
- `http://127.0.0.1:18087/health`

### Recovered local source build

- `http://127.0.0.1:18088/client/session`
- `http://127.0.0.1:18088/client/snapshot`
- `http://127.0.0.1:18088/health`

## Probe summary

### 1) Public unauthenticated client routes

Observed live public behavior:

- `GET /client/session` → `401 CLIENT_PORTAL_AUTH_REQUIRED`
- `GET /client/snapshot` → `401 CLIENT_PORTAL_AUTH_REQUIRED`
- body:
  - `{"error":"CLIENT_PORTAL_AUTH_REQUIRED","message":"Bearer token is required for client portal routes"}`

Recovered state after alignment work on 2026-03-16:

- `GET /client/session` → `401 CLIENT_PORTAL_AUTH_REQUIRED`
- `GET /client/snapshot` → `401 CLIENT_PORTAL_AUTH_REQUIRED`
- body matches the live public body string

Verdict:

- **aligned** for the externally visible unauthenticated auth contract

### 2) Invalid bearer token handling

Observed live public + internal behavior:

- `Authorization: Bearer invalid-token`
- `GET /client/session` → `401 CLIENT_PORTAL_AUTH_INVALID`
- `GET /client/snapshot` → `401 CLIENT_PORTAL_AUTH_INVALID`
- body:
  - `{"error":"CLIENT_PORTAL_AUTH_INVALID","message":"Client access token format is invalid"}`

Recovered behavior before alignment:

- returned `403`
- used a dev-specific invalid-token message

Recovered state after alignment work on 2026-03-16:

- now returns `401`
- now returns the live message string

Verdict:

- **aligned** for the currently reachable invalid-token contract

### 3) Internal edge/TLS gate behavior

Observed live internal behavior on port `18087`:

- direct request to `/client/session` without `x-forwarded-proto=https`
  - `403 OPERATIONAL_API_TLS_REQUIRED`
- direct request to `/client/snapshot` without `x-forwarded-proto=https`
  - `403 OPERATIONAL_API_TLS_REQUIRED`
- once `x-forwarded-proto=https` is provided, the same routes fall through to the bearer-token checks

Example live internal body:

- `{"error":"OPERATIONAL_API_TLS_REQUIRED","message":"Operational API requires TLS. Terminate TLS at the edge and pass x-forwarded-proto=https."}`

Recovered behavior:

- does **not** currently enforce the forwarded-TLS gate
- falls straight into bearer-token auth checks

Verdict:

- **not aligned yet** for the direct internal runtime contract

Notes:

- this is the biggest remaining contract difference found in reachable routes
- it may be acceptable to keep this as a dev-mode difference temporarily, because strict enforcement would break direct local browser use unless the recovered app is also run behind a local edge/proxy shim

### 4) `/health` shape

Observed live public + internal behavior:

- `/health` returns the minimal body:
  - `{"ok":true}`

Recovered behavior:

- `/health` returns `{"ok":true,...}` plus extra recovery diagnostics:
  - `mode`
  - `source`
  - `truths`
  - `counts`
  - `generated_at`

Verdict:

- **semantically compatible but not contract-identical**

Notes:

- if strict cutover parity matters, recovered `/health` should be reduced to the minimal live shape or moved behind a separate debug route
- if local diagnostics matter more for now, this drift is harmless and arguably useful

### 5) Response headers

Observed live internal/public responses consistently include:

- `cache-control: no-store`
- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: no-referrer`
- `x-request-id: req_...`

Recovered behavior before alignment:

- lacked the security headers above
- lacked `x-request-id`
- used pretty-printed JSON bodies rather than compact JSON

Recovered state after alignment work on 2026-03-16:

- now emits those security headers
- now emits `x-request-id`
- now emits compact JSON bodies

Remaining header differences:

- live public edge adds Cloudflare-specific headers (`cf-ray`, `cf-cache-status`, `server: cloudflare`, `x-pmhnp-client-proxy`)
- recovered local server obviously does not
- recovered local CORS allow-headers remain broader than the public edge contract

Verdict:

- **core security/header posture is now much closer**
- **edge/proxy-specific headers remain intentionally different**

## What could not be compared safely

Not yet compared:

- successful authenticated `200` responses from the live client routes
- live onboarding route behavior beyond the reconstructed contract work
- any private write path that would require production credentials or non-read-only intervention

Reason:

- no valid production bearer token was used during this diff pass
- the goal of this pass was safe read-only comparison only

## Low-risk alignments applied during this diff pass

The recovered source workspace was updated to reduce obvious drift:

- invalid-token responses now match live status/message behavior
- compact JSON responses now better match live bodies
- security headers and `x-request-id` were added to recovered responses

These changes were safe because they do not require secrets and do not mutate the zombie runtime.

## Overall assessment

The recovered backend is now in **good shape for the externally visible unauthenticated auth contract**.

Most important current truth:

- **public client auth behavior now matches live well enough to trust the reconstruction on that surface**
- **internal runtime parity is still incomplete because the recovered server does not yet emulate the live forwarded-TLS gate**
- **`/health` is still more verbose than live**

## Recommended next steps

1. Decide whether to preserve local-dev convenience or add an opt-in edge/TLS gate mode to the recovered server.
2. Compare authenticated live `200` responses only if a safe temporary token or staging-equivalent auth path becomes available.
3. Before any cutover, either:
   - reduce recovered `/health` to the live minimal shape, or
   - explicitly document that `/health` will change as part of cutover.
4. Keep treating production as a zombie runtime until source-level parity is stronger than "public surface looks right." 
