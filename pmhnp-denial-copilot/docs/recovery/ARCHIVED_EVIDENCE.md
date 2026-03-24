# Archived Evidence Used for Reconstruction

This file records the evidence trail used to rebuild this workspace without pretending the original private repo was fully recovered.

## 1) Archived OpenClaw backup session evidence

From the archived backup session JSONL files inside:

`/root/recovery/ct101-snapshot-20260314T193926Z-2074400/2026-03-14T19-39-48.606Z-openclaw-backup.tar.gz`

Relevant session references:

### Tebra-first / client-bridge state

- `.../sessions/oracle-37401c9be82d.jsonl`
  - describes the repo as **Tebra-first / read-mostly**
  - states Tebra remains source of truth
  - references `ARCHITECTURE_TEBRA_FIRST` and `docs/CLIENT_APP_BRIDGE`
  - notes `live_tebra_oauth=false`
  - notes `pilot_manual_connection_request=true`
  - notes onboarding route contracts like `/v1/onboarding/tebra/session` were documented, but not yet proven live in app routes at that moment

### OAuth click-attach implementation direction

- `.../sessions/oracle-b77b1d66939a.jsonl`
- `.../sessions/oracle-d3e5f30301d1.jsonl`
- `.../sessions/oracle-2f09700fe996.jsonl`

These archived sessions consistently indicate:

- polished live OAuth click-attach was considered **possible**
- rollout state was still **human-first/manual**, not fully self-serve
- onboarding API contracts were already specified

### Provider-profile / live-read adapter evidence

- `.../sessions/oracle-ead24c2a8d6e.jsonl`
- `.../sessions/oracle-5e4968980eff.jsonl`
- `.../sessions/oracle-b2af36399a6a.jsonl`

These archived sessions indicate the build had progressed to claims such as:

- a real provider-profile/live-read adapter layer existed
- onboarding used a live-read path for `api_oauth` and `export_feed` when provider profile config was present
- incomplete profiles failed closed instead of silently pretending success

## 2) Live public app evidence

Recovered directly from the still-live public deployment:

- `public/app/index.html`
- `public/app/app.js`
- `public/app/intake.html`
- `public/app/data/dashboard-snapshot.json`

These assets confirm the real shipped pilot experience exposed:

- a token-gated client dashboard
- a local onboarding packet builder
- honest rollout flags about what is live vs pilot-only

## 3) Local host/runtime evidence

Direct local inspection confirmed:

- `cloudflared` is forwarding to `http://127.0.0.1:18087`
- the local operational API health check is alive
- the runtime still points at `/root/.openclaw/workspace/pmhnp-denial-copilot`
- the referenced directory is absent from the current visible filesystem

That mismatch is why this workspace was rebuilt from evidence instead of copied from production.
