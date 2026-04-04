# Mailchimp full audit gap-closure checklist — 2026-04-04

## Grounding
- **Source audit:** `docs/MAILCHIMP_FULL_AUDIT_2026-04-04.md`
- **Target path:** `/root/clawd/mailchimp-clone`
- **Requested fidelity:** `full_clone`
- **Current truth:** `parity_for_scope`
- **Purpose of this checklist:** turn the audit into a concrete, falsifiable closure plan for moving from broad simulation to something that could honestly approach a true Mailchimp clone claim

## How to use this checklist
A box is only complete when:
1. the product surface exists in actual app code
2. the behavior is Mailchimp-like, not just named similarly
3. there is executable verification
4. the audit report can be updated with evidence instead of aspiration

## Closure rule
Do **not** claim `full_clone` until every section below is either:
- marked complete with evidence, or
- explicitly removed from scope by the human

---

## A. Public brand + marketing parity

### A1. Replace non-Mailchimp brand shell
- [ ] Remove or isolate `Anchor Mailer` naming from user-visible Mailchimp-clone surfaces
- [ ] Align page titles, nav labels, and marketing copy with the intended clone target
- [ ] Replace generic inline-card home page with a Mailchimp-like public marketing homepage
- [ ] Add plan/pricing, feature summary, and conversion CTA structure comparable to public Mailchimp pages

### A2. Rebuild public marketing site structure
- [ ] Homepage parity pass
- [ ] Feature landing pages parity pass
- [ ] Pricing surface parity pass
- [ ] Help/support entry surface parity pass
- [ ] Developer/API public surface parity pass

### Acceptance evidence
- [ ] Browser proof for public homepage
- [ ] Browser proof for pricing page
- [ ] Browser proof for at least 5 major feature pages
- [ ] Before/after comparison screenshots or route capture

---

## B. Frontend architecture parity

### B1. Replace server-rendered HTML-only interaction model where Mailchimp depends on rich client UX
Current audit blocker:
- clone currently has `0` modern client-surface files and is rendered from HTML string templates

Required closure:
- [ ] Introduce a real client application shell for interactive surfaces
- [ ] Add persistent client state for editors/builders
- [ ] Add modal/drawer/panel behavior matching modern Mailchimp interaction patterns
- [ ] Replace simple form-post editing for high-interaction surfaces with richer client workflows

### B2. Editor parity
- [ ] Rich email editor parity
- [ ] Rich journey builder parity
- [ ] Rich website builder parity
- [ ] Rich popup form editor parity
- [ ] Content asset/media editor parity

### Acceptance evidence
- [ ] Browser-driven tests for editor interactions
- [ ] Drag/drop or equivalent interaction proof where Mailchimp exposes it
- [ ] Undo/redo or revision UX where applicable
- [ ] Interaction latency/state preservation proof

---

## C. Data model + persistence parity

### C1. Replace JSON-file core persistence
Current audit blocker:
- `packages/app/storage.mjs` rewrites `data/app.json`

Required closure:
- [ ] Move primary state to a real database-backed persistence layer
- [ ] Add schema migrations
- [ ] Add transaction or equivalent concurrency-safe write model
- [ ] Add environment-aware config for local/dev/test/prod storage
- [ ] Remove dependence on synchronous monolithic JSON writes for core entities

### C2. Expand data model depth
- [ ] Campaign data model parity
- [ ] Audience/contact profile parity
- [ ] Website/page/layout/component parity
- [ ] Experiment and reporting event data parity
- [ ] Integration install/auth/sync state parity
- [ ] Audit/governance/security event parity

### Acceptance evidence
- [ ] Schema inventory doc
- [ ] Migration files committed
- [ ] Concurrency/integrity tests
- [ ] No critical product flow depends on `saveDb(state.db)` JSON rewrite path

---

## D. Delivery + jobs + operational workflow parity

### D1. Replace in-process job loop
Current audit blocker:
- `setInterval(() => runJobs(state), 100)` in app process

Required closure:
- [ ] Separate web process from worker process
- [ ] Real queue or durable background-job mechanism
- [ ] Retry policy with durable attempt history
- [ ] Dead-letter / failure replay workflow
- [ ] Operational visibility into queue depth and worker health

### D2. Delivery realism
- [ ] Real email provider abstraction
- [ ] Real test-send path
- [ ] Real delivery status ingestion path
- [ ] Bounce/unsubscribe/complaint event handling
- [ ] Transactional messaging provider path

### Acceptance evidence
- [ ] Worker integration tests
- [ ] Delivery provider contract tests
- [ ] Event ingestion tests
- [ ] Operational runbook doc

---

## E. Reporting + analytics parity

### E1. Replace synthetic metrics
Current audit blocker:
- opens/clicks and website metrics are locally synthesized or incremented counters

Required closure:
- [ ] Real event model for campaign activity
- [ ] Real event model for website/form/landing interactions
- [ ] Attribution logic beyond static counters
- [ ] Segment/report drilldown support
- [ ] Historical time-series reporting

### E2. Reporting surfaces
- [ ] Campaign performance parity
- [ ] Journey performance parity
- [ ] Website/page analytics parity
- [ ] Popup form analytics parity
- [ ] Revenue attribution parity

### Acceptance evidence
- [ ] Event schema and ingestion path
- [ ] Historical report tests
- [ ] Funnel attribution tests
- [ ] Report API/browser proof across multiple time ranges

---

## F. AI / predictive / optimization parity

### F1. Replace heuristic-only AI shells
Current audit blocker:
- AI features are deterministic helper functions, not model-backed systems

Required closure:
- [ ] Add provider-backed AI service abstraction
- [ ] Add prompting / generation / safety flow
- [ ] Add traceable acceptance/apply UX for generated content
- [ ] Add failure and quota handling

### F2. Predictive/optimization depth
- [ ] Predictive segmentation parity
- [ ] Send-time optimization parity
- [ ] Product recommendation parity
- [ ] Experiment winner logic based on real metrics, not string-length formulas

### Acceptance evidence
- [ ] AI integration tests with mock/provider boundary
- [ ] Predictive model input/output contract doc
- [ ] Reported experiment results derived from event data

---

## G. Integrations + API + OAuth parity

### G1. Replace simulated installs/syncs with real connector runtime
Current audit blocker:
- app/runtime code shows no real provider `fetch()` path for core integrations

Required closure:
- [ ] Real OAuth flow for supported integrations
- [ ] Token storage + refresh lifecycle
- [ ] Real sync jobs for at least the primary provider set
- [ ] Real uninstall cleanup behavior
- [ ] Error surfacing comparable to Mailchimp integration expectations

### G2. API/developer parity
- [ ] Marketing API shape audit
- [ ] Webhook behavior parity audit
- [ ] API key / auth model parity audit
- [ ] Batch operation parity audit

### Acceptance evidence
- [ ] Connector contract tests
- [ ] OAuth callback tests
- [ ] Webhook replay tests
- [ ] External-provider sandbox verification where possible

---

## H. Website builder parity

### H1. Editing experience
Current audit blocker:
- current builder is record/page/theme-based, not true live visual editing

Required closure:
- [ ] Visual page composition model
- [ ] Section library parity
- [ ] On-canvas edit flow
- [ ] Media manipulation parity
- [ ] Preview/responsive/device-mode parity
- [ ] Undo/redo and publish diff/history parity

### H2. Site-level feature depth
- [ ] SEO controls parity
- [ ] Appointment/store/widget capability audit
- [ ] Site-level reporting parity
- [ ] Domain/publish workflow parity

### Acceptance evidence
- [ ] Browser-recorded build/edit/publish flow
- [ ] Layout component snapshot tests
- [ ] Site publish/version tests

---

## I. Forms / popup forms / landing pages parity

### I1. Popup form feature depth
Current audit blocker:
- current forms are hosted forms with fields and publish state, not real Mailchimp popup-form product depth

Required closure:
- [ ] Incentive/template selection
- [ ] Popup-specific editor
- [ ] Advanced targeting rules
- [ ] Geotargeting
- [ ] Trigger rules (time on page, inactivity, exit intent, etc.)
- [ ] SMS/email dual-capture flows where appropriate
- [ ] Connected-site / Shopify behavior parity
- [ ] Popup metrics and variant reporting

### I2. Landing page parity
- [ ] Richer landing page template/editing system
- [ ] Campaign/form linkage parity
- [ ] Analytics and experiment hooks

### Acceptance evidence
- [ ] Popup rule engine tests
- [ ] Browser proof of popup trigger behavior
- [ ] Metrics/reporting proof

---

## J. Campaign experimentation parity

### J1. A/B + multivariate depth
Current audit blocker:
- experiment logic is simplified and formula-driven

Required closure:
- [ ] Subject/content/from-name/send-time variant support parity
- [ ] Multi-variant support comparable to target plan behavior
- [ ] Auto-winner send behavior based on real observed metrics
- [ ] Audience split controls and holdout behavior parity

### Acceptance evidence
- [ ] Experiment lifecycle tests
- [ ] Metric-driven winner selection tests
- [ ] Browser/UI proof for experiment setup and results

---

## K. Automation / journey parity

### K1. Journey engine depth
Current audit blocker:
- journeys exist, but execution model is simplified local state progression

Required closure:
- [ ] Richer trigger library
- [ ] Richer conditional branches
- [ ] Delay/wait-state persistence parity
- [ ] Multi-channel action parity
- [ ] Re-entry, suppression, and eligibility rules parity
- [ ] Goal/exit behavior parity

### Acceptance evidence
- [ ] Engine tests for delayed and branching flows
- [ ] Event-triggered integration tests
- [ ] Browser proof for journey builder interactions

---

## L. Audience / CRM / segmentation parity

### L1. Contact and CRM depth
- [ ] Richer contact profile model
- [ ] Richer engagement timeline
- [ ] Purchase/lifecycle state parity
- [ ] Tags/groups/interests behavior audit against target

### L2. Segmentation depth
Current Mailchimp public claim includes behavioral targeting and predictive segmentation

Required closure:
- [ ] Behavioral rules parity
- [ ] Pre-built segment parity
- [ ] Predictive segment parity
- [ ] Cross-channel segment usage parity

### Acceptance evidence
- [ ] Segment builder tests
- [ ] Cross-surface reuse tests
- [ ] Predictive segment validation tests

---

## M. Security / account / enterprise parity

### M1. SaaS security depth
Current audit blocker:
- basic security is present, but still local-clone grade rather than Mailchimp-equivalent

Required closure:
- [ ] MFA / stronger account security parity audit
- [ ] Enterprise/SSO/security posture audit
- [ ] Session/device management depth
- [ ] CSRF and advanced abuse protection verification
- [ ] Audit/event immutability model

### Acceptance evidence
- [ ] Security regression tests
- [ ] Threat-model doc
- [ ] Session/auth policy tests

---

## N. Ops / deployment / scale realism

### N1. Runtime realism
- [ ] Multi-process deployment model
- [ ] Environment configuration separation
- [ ] Observability / logs / metrics / health checks
- [ ] Backup/recovery and migration procedures
- [ ] Performance/load benchmark coverage

### Acceptance evidence
- [ ] Deployment docs
- [ ] Health check suite
- [ ] Load-test artifacts

---

## O. Final parity proof gate
Do not claim `full_clone` until all are true:
- [ ] Public product experience is Mailchimp-like, not generic
- [ ] Rich-client interaction parity exists for key builders/editors
- [ ] Core persistence is not JSON-file backed
- [ ] Delivery, jobs, analytics, and integrations are provider-real enough to stop being simulations
- [ ] AI/predictive/experimentation features are not heuristic placeholders
- [ ] Website builder and popup forms reach feature/interaction parity for observable public Mailchimp behavior
- [ ] Regression + browser tests cover all major product families
- [ ] Audit report is updated from `parity_for_scope` to `full_clone` with concrete proof

## Current bottom line
As of this checklist’s creation:
- **Current truth:** `parity_for_scope`
- **Not yet truthful:** `full_clone`
- **Primary blocker cluster:** frontend architecture + persistence + delivery/integration realism + analytics/AI realism
