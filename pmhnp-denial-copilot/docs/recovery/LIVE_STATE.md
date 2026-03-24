# Live State Verified on 2026-03-16

## Public surfaces

Verified live during recovery:

- `https://pmhnpbilling.com/app/`
  - serves the PMHNP Billing denial-ops client app shell
- `https://pmhnpbilling.com/app/intake.html`
  - serves the onboarding intake page with local packet generation
- `https://pmhnpbilling.com/client/session`
  - returns `401 CLIENT_PORTAL_AUTH_REQUIRED` without bearer token
- `https://pmhnpbilling.com/client/snapshot`
  - returns `401 CLIENT_PORTAL_AUTH_REQUIRED` without bearer token
- `https://api.pmhnpbilling.com/health`
  - returns `{"ok":true}`

Probe outputs were saved to:

- `docs/recovery/live-probes/pmhnpbilling.com__client__session.txt`
- `docs/recovery/live-probes/pmhnpbilling.com__client__snapshot.txt`
- `docs/recovery/live-probes/api.pmhnpbilling.com__health.txt`

## Local runtime evidence

Verified locally on the host:

- a Node runtime is still serving the operational API on port `18087`
- the running command references:
  - `src/ops/operationalHttpServerCli.ts`
  - working directory: `/root/.openclaw/workspace/pmhnp-denial-copilot`
- that referenced working directory is **missing from the current visible filesystem**
- `cloudflared` is tunneling traffic to `http://127.0.0.1:18087`

Implication:

- the PMHNP app is still alive at runtime
- the original source tree is not in a clean on-disk state
- production should be treated as a **zombie runtime**, not a trustworthy editable workspace

## Shipped client truths recovered from live app assets

Recovered from `public/app/app.js` and `public/app/data/dashboard-snapshot.json`:

- `live_tebra_oauth = false`
- `live_client_auth_provisioning = false`
- `claim_auto_submission = false`
- `pilot_manual_connection_request = true`
- `local_onboarding_packet_builder = true`

These match the visible UI language:

- dashboard/intake packet builder works now
- direct Tebra OAuth remains pilot-gated or not yet live
