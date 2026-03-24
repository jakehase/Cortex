# ARCHITECTURE_TEBRA_FIRST

## Core stance

Tebra remains the **source of truth**.

This recovered backend is intentionally:

- **read-mostly**
- **human-reviewed**
- **fail-closed** when provider profile/config is incomplete
- **non-autonomous** for claim mutation or submission
- **automatic for low-risk preparation**, but never for live-read release or writeback without policy/approval

## What is live in this recovered build

- public client app shell
- token-gated client snapshot/session routes
- onboarding intake -> backend session capture
- automated intake preparation route (`/v1/onboarding/tebra/intake/automate`)
- preflight checks for onboarding completeness
- pilot manual connection request creation
- approval queue for live-read release
- manual-review approval/rejection step for provider profiles
- append-only audit events for onboarding/approval/test transitions
- read-only connection-test contract after approval
- mapping validation contract

## What is not live in this recovered build

- self-serve in-app Tebra OAuth click-attach
- automatic client auth provisioning
- autonomous claim submission
- writeback into Tebra or payer systems

## Attach path

1. Intake packet is captured.
2. Backend creates onboarding session.
3. Preflight validates required fields.
4. Automation may auto-create the pilot request if policy allows.
5. Activation creates a **pending manual review** provider profile.
6. The backend creates a **pending approval queue item** for live-read access.
7. Manual review approval flips the provider profile to **ready for live reads**.
8. Connection tests can then pass in **read-only** mode.

## Automation safety spine

Internal automation policy currently allows:

- automatic onboarding/session preparation
- automatic read-only preflight
- automatic pilot-request creation

Internal automation policy still blocks:

- live-read release without approval
- writeback without approval
- claim submission/autonomous mutation

This keeps the product shape:

- **automatic for preparation**
- **human-gated for consequential access**
- **audited for every state transition**

## Why this shape

This matches the archived evidence:

- rollout honesty flags still show `live_tebra_oauth=false`
- rollout honesty flags still show `pilot_manual_connection_request=true`
- provider-profile/live-read adapter behavior was described as real, but self-serve OAuth was not yet live

So the recovered build preserves the safe behavior first, then opens read-only validation after manual review instead of pretending the lost private backend is fully rebuilt.
