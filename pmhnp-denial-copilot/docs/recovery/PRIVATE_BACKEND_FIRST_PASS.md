# Private Backend First Pass

## What was rebuilt

A first-pass private backend route layer now exists in source form under `src/`.

### Entry point

- `src/ops/operationalHttpServerCli.mjs`

### Main modules

- `src/http/createServer.mjs`
- `src/domain/clientPortal.mjs`
- `src/domain/tebraOnboarding.mjs`
- `src/lib/storage.mjs`
- `src/config.mjs`

## Route contracts implemented

### Client portal

- `GET /health`
- `GET /client/session` (bearer token required)
- `GET /client/snapshot` (bearer token required)

### Tebra onboarding

- `POST /v1/onboarding/tebra/session`
- `POST /v1/onboarding/tebra/intake/automate`
- `GET /v1/onboarding/tebra/session/:id`
- `GET /v1/onboarding/tebra/sessions`
- `POST /v1/onboarding/tebra/preflight`
- `POST /v1/onboarding/tebra/activate`
- `POST /v1/onboarding/tebra/manual-review/approve`
- `POST /v1/onboarding/tebra/manual-review/reject`
- `POST /v1/onboarding/tebra/connection-test`
- `POST /v1/onboarding/tebra/mapping-validate`
- `GET /v1/onboarding/tebra/provider-profile/:id`
- `GET /v1/onboarding/tebra/provider-profiles`

### Approval + audit layer

- `GET /v1/approvals`
- `GET /v1/approvals/:id`
- `POST /v1/approvals/:id/approve`
- `POST /v1/approvals/:id/reject`
- `GET /v1/audit/events`

### Security mode

Configurable production-style security can now be enabled for the recovered server:

- forwarded-TLS gate for `/client/...` and `/v1/...`
- signed bearer auth for `/client/...` and `/v1/...`
- role/scoped operational authorization for `/v1/...`
- actor-header enforcement for `/v1/...`
- optional legacy static token fallback when explicitly enabled

### Auth routes

- `POST /v1/auth/client/login`
- `POST /v1/auth/ops/login`

## Safety behavior preserved

- direct self-serve OAuth remains blocked
- activation fails closed when preflight does not pass
- automated intake preparation still stops at the approval gate
- connection tests fail closed before manual review approval
- rejection keeps live-read access blocked until a new approval request is created
- claim auto-submission remains disabled
- all connection test success states are read-only
- audit events are appended for onboarding, approval, rejection, and connection-test transitions

## Smoke tests that passed

### Pilot-assisted flow

1. create onboarding session
2. preflight passes
3. activate creates `pending_manual_review` provider profile
4. manual review approve flips profile to `ready_for_live_reads`
5. connection-test passes in read-only mode

### Direct OAuth blocked flow

1. create onboarding session in `direct-oauth-not-live` mode
2. preflight returns blocker `LIVE_TEBRA_OAUTH_DISABLED`
3. activate is rejected with `TEBRA_PRECHECK_FAILED`

### Fail-closed behavior before approval

1. create pilot-assisted onboarding session
2. activate creates `pending_manual_review` provider profile
3. connection-test returns `TEBRA_MANUAL_REVIEW_PENDING`

## Smoke coverage added after first pass

A local smoke harness now runs against the recovered server using temporary state/public directories so validation does not mutate the checked-in recovery evidence.

Covered flows now include:

- `/health`
- unauthenticated and invalid-token client portal checks
- valid bearer access to `/client/session` and `/client/snapshot`
- signed token issuance for client, reviewer, and admin roles
- reviewer blocked from admin-only audit route
- pilot-assisted onboarding create → preflight → activate → pending approval
- approval queue list/get/approve
- automated intake preparation → rejection → re-activation → approval
- fail-closed connection test before manual review approval
- fail-closed connection test after rejection
- manual review approval → read-only connection-test success
- audit event capture
- strict forwarded-TLS + operational auth + actor-header enforcement
- mapping validation success path
- blocked direct OAuth flow (`LIVE_TEBRA_OAUTH_DISABLED` → `TEBRA_PRECHECK_FAILED`)

Run with:

```bash
npm run smoke
```

## Caveat

This is a faithful recovery-oriented first pass, not proof that the original lost private backend has been fully recreated line-for-line.
