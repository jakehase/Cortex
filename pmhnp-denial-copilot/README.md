# PMHNP Claim Guard — Tebra-First Pilot Workspace

This repo is no longer positioned as a generic AI product shell.

It is a **PMHNP revenue-cycle / denial-ops product** focused on one brutally clear use case:

> **Take Tebra exports from a PMHNP practice, flag likely denials before submit, organize denied claims after they land, route the next action, and prove ROI during a live pilot.**

That means the product is about:

- PMHNP-specific denial triage
- appeal / follow-up workflow support
- Tebra-first onboarding and data intake
- measurable pilot evidence: dollars recovered, dollars protected, time saved, denial prevention

It is **not** positioned as a broad autonomous medical billing system.

## What is implemented in this repo now

### 1) Clear use case across code + UI

The app and docs are sharpened around:

- **Tebra-first PMHNP Claim Guard worklists**
- **human-reviewed denial routing and appeals support**
- **pilot ROI proof**, not vague automation claims

### 2) Live-pilot evidence scaffolding

Concrete pilot instrumentation is now in the codebase:

- `POST /v1/pilot/baseline` — save a per-practice baseline
- `POST /v1/pilot/event` — record real pilot events
- `POST /v1/pilot/report` — generate a report with:
  - dollars recovered
  - dollars protected
  - staff minutes saved
  - estimated ROI %
  - overturn rate
  - prevention rate vs baseline

State is stored under:

- `state/pilot-metrics/baselines/`
- `state/pilot-metrics/events/`
- `state/pilot-metrics/reports/`

### 3) Realer PMHNP integration moat in-repo

The repo now includes concrete specialty logic instead of generic workflow language:

- `src/domain/denialWorkbench.mjs`
- PMHNP denial taxonomy with buckets for:
  - missing/expired auth
  - telehealth POS/modifier mismatch
  - psych documentation support gaps
  - eligibility / COB / carve-out issues
  - timely filing risk
  - NPI / taxonomy / enrollment mismatch
- specialty ruleset (`pmhnp-tebra-denial-v1`)
- denial scoring endpoint: `POST /v1/denials/score`
- denial feedback loop endpoint: `POST /v1/denials/feedback`
- persisted learning stats endpoint: `GET /v1/denials/learning`
- artifact ingestion endpoint: `POST /v1/denials/artifacts`
- claim-risk and denial-recovery worklist endpoint: `GET /v1/denials/worklists`

This is now a stronger **in-repo denial intelligence layer** with persisted reviewer feedback, confidence adjustment, label-drift tracking, reviewer-confirmed outcomes, and worklist generation from CSV/JSON denial artifacts.

### 4) Sharper product positioning

Public copy and app copy now frame this as:

- PMHNP Claim Guard
- PMHNP revenue-cycle workflow support
- Tebra workflow automation for denial follow-up
- draft-only, human-reviewed action support

## Current product truth

### Works now

- Tebra export upload intake
- admin-assisted live sync request flow
- approval queue and audit trail
- PMHNP denial taxonomy + scoring with learned confidence shifts
- denial feedback capture with persisted learning stats and label-drift tracking
- CSV/JSON denial/remit/worklist artifact ingestion into normalized claim-risk and denial-recovery worklists
- pilot ROI baseline / event / report instrumentation
- dashboard support for onboarding + review workflows

### Not yet fully real without external/live data

- payer-remit-grounded automatic ROI proof
- real-time Tebra remittance ingestion
- automatic claim submission/writeback
- self-serve Tebra OAuth click-connect
- fully validated production denial labels from real pilot traffic

Those limits are real. This repo implements the strongest in-repo version possible without fabricating live pilot evidence.

## Key routes

### Client / intake

- `GET /health`
- `GET /client/session`
- `GET /client/snapshot`
- `POST /v1/public/tebra/intake`

### Onboarding / Tebra

- `POST /v1/onboarding/tebra/session`
- `POST /v1/onboarding/tebra/export-upload`
- `POST /v1/onboarding/tebra/preflight`
- `POST /v1/onboarding/tebra/activate`
- `POST /v1/onboarding/tebra/manual-review/approve`
- `POST /v1/onboarding/tebra/manual-review/reject`
- `POST /v1/onboarding/tebra/connection-test`
- `POST /v1/onboarding/tebra/mapping-validate`

### Denial intelligence

- `GET /v1/denials/taxonomy`
- `POST /v1/denials/score`
- `GET /v1/denials/feedback`
- `POST /v1/denials/feedback`
- `GET /v1/denials/learning`
- `GET /v1/denials/artifacts`
- `POST /v1/denials/artifacts`
- `GET /v1/denials/worklists`

### Pilot ROI

- `GET /v1/pilot/baseline`
- `POST /v1/pilot/baseline`
- `POST /v1/pilot/event`
- `POST /v1/pilot/report`

## Local usage

```bash
cd /root/clawd/pmhnp-denial-copilot
npm start
```

Open:

- `http://127.0.0.1:18088/`
- `http://127.0.0.1:18088/app/`
- `http://127.0.0.1:18088/app/intake.html`

## Validation

```bash
npm run smoke
```

The smoke test now validates:

- existing onboarding/auth/approval flows
- denial taxonomy + specialty scoring
- denial feedback recording
- pilot baseline/event/report generation
- client snapshot enrichment

## Why this matters fundability-wise

The strongest story this repo can now support is:

1. **Narrow wedge:** PMHNP Claim Guard worklists from Tebra exports
2. **Proof loop:** baseline → pilot events → ROI report
3. **Domain moat:** PMHNP denial taxonomy + rules + feedback data model
4. **Credible positioning:** claim-risk screening + denial recovery workflow automation, not generic agent hype
