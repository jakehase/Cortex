# CLIENT_APP_BRIDGE

## Truth flags

The client app and recovered backend currently expose these truths:

```json
{
  "live_tebra_oauth": false,
  "live_client_auth_provisioning": false,
  "claim_auto_submission": false,
  "pilot_manual_connection_request": true,
  "local_onboarding_packet_builder": true
}
```

## Automation policy

The recovered backend now has an explicit internal automation policy separate from the public truth flags.

Current policy shape:

```json
{
  "auto_prepare_onboarding": true,
  "auto_run_readonly_preflight": true,
  "auto_activate_pilot_request": true,
  "require_human_approval_for_live_reads": true,
  "require_human_approval_for_writeback": true,
  "writeback_enabled": false
}
```

Meaning:

- onboarding preparation can be automatic
- live-read release cannot be automatic
- writeback cannot be automatic

## Operational security mode

The recovered backend can also emulate a stricter production-style security posture.

Current security switches:

```json
{
  "require_forwarded_tls": false,
  "enforce_operational_auth": false,
  "require_actor_headers": false
}
```

When enabled in environment/config:

- `/client/session` and `/client/snapshot` require `x-forwarded-proto=https`
- `/v1/...` routes require:
  - `x-forwarded-proto=https`
  - bearer auth with the operational API token
  - `x-actor-id`
  - `x-role`

## Signed access tokens

The recovered backend now supports signed bearer tokens in addition to optional legacy static tokens.

Login routes:

- `POST /v1/auth/client/login`
- `POST /v1/auth/ops/login`

Current role model:

- `client` → client dashboard access
- `reviewer` → client access + operational onboarding/approval access
- `admin` → reviewer access + audit access

Scopes are enforced separately from role labels:

- `client`
- `ops`
- `audit`

## Client portal routes

### `GET /client/session`
Requires bearer token.

Accepted token types:

- signed client token
- signed reviewer/admin token with `client` scope
- legacy static token if legacy mode is still enabled

Returns:

- current truth flags
- available client/backend routes
- dev-mode session metadata

### `GET /client/snapshot`
Requires bearer token.

Returns:

- dashboard snapshot
- truth flags
- automation policy summary
- approval queue counts + pending items
- local onboarding/provider-profile state folded into the snapshot
- source metadata marked as `operational-api-client-live`

## Onboarding routes

### `POST /v1/onboarding/tebra/session`
Captures an onboarding packet and creates a server-side session.
In strict security mode this requires a signed token with appropriate scope.

### `POST /v1/onboarding/tebra/intake/automate`
Captures intake, runs read-only preflight, and auto-prepares the pilot request when policy allows.
It still stops at the approval gate before live reads.
In strict security mode this route can be called by a signed `client` token or by reviewer/admin operations access.

### `POST /v1/onboarding/tebra/preflight`
Evaluates readiness, warnings, blockers, and fail-closed state.

### `POST /v1/onboarding/tebra/activate`
Creates a manual-pilot provider profile, creates a pending approval queue item, and moves the session to `pilot_manual_connection_requested`.

### `POST /v1/onboarding/tebra/manual-review/approve`
Approves the provider profile for **read-only live-read testing**.

### `POST /v1/onboarding/tebra/manual-review/reject`
Rejects the provider profile for live-read release and keeps the flow fail-closed.

### `GET /v1/approvals`
Lists approval queue items.

### `POST /v1/approvals/:id/approve`
Approves a pending queue item by routing through the same manual-review safety logic.

### `POST /v1/approvals/:id/reject`
Rejects a pending queue item by routing through the same manual-review safety logic.

### `GET /v1/audit/events`
Returns append-only audit events for the recovered backend.

### `POST /v1/onboarding/tebra/connection-test`
Runs a fail-closed connection test. It only passes after manual review approval.

### `POST /v1/onboarding/tebra/mapping-validate`
Validates required contract mappings and refuses to guess missing fields.

## Auth model

- Client portal routes are bearer-token gated.
- Onboarding routes are currently public in local recovered dev mode so the intake page can use them directly.
- This is a recovery/dev bridge, not final production auth design.

## Approval operations panel

The recovered client app now includes a small reviewer operations panel that can:

- save a separate reviewer/admin operations token
- exchange a reviewer/admin access key for a signed token
- save actor identity (`x-actor-id`) and role (`x-role`)
- list pending approvals using `/v1/approvals`
- approve or reject queue items from the dashboard

The client dashboard panel can also exchange a client access key for a signed client token.

This keeps the client-facing dashboard token separate from reviewer/admin operational access.

## Safety model

- No automatic claim submission
- No silent fallback to pretend success when provider profile is incomplete
- Manual review remains a hard gate before live-read connection tests pass
- Approval queue is the source of truth for live-read release
- Audit events are written for onboarding, approval, rejection, and connection-test transitions
- Production-style route protection can be enabled without removing local dev mode
