# Mailchimp Current-Product Parity Gap Roadmap — 2026-04-03

## Grounding

- **Anchor:** the strict parity-gap audit requested immediately before this document
- **Target repo:** `/root/clawd/mailchimp-clone`
- **Current fidelity (honest):** `parity_for_scope`
- **Desired fidelity for this roadmap:** move toward a stricter current-product `full_clone` standard instead of only satisfying the repo's earlier declared scope
- **Implementation surface for future work:** product code, domain logic, routes/UI flows, tests, smoke coverage, and parity proof artifacts
- **Stop condition for the future program described here:** every gap below has executable product-surface coverage, browser-visible proof where applicable, and a refreshed surface matrix showing the current-product gap set resolved or explicitly downgraded with evidence

## Evidence Sources Used

### Observed local repo evidence
- `packages/app/routes/forms.mjs`
- `packages/app/routes/campaigns.mjs`
- `packages/app/routes/automations.mjs`
- `packages/app/routes/content-asset-templates.mjs`
- `packages/app/routes/integrations-marketplace.mjs`
- `packages/app/routes/reports.mjs`
- `packages/app/routes/expansion-showcase.mjs`
- `tests/platform-spine.test.mjs`
- `tests/reports-admin.test.mjs`
- `tests/browser-realism.test.mjs`
- repo-level program tests and `scripts/smoke-full-clone.mjs`

### Observed external footprint evidence
- `https://mailchimp.com/features/` product-marketing feature footprint
- Mailchimp public feature framing around website building, AI-assisted marketing, broader optimization, and ecosystem breadth

## Honest Top-Level Verdict

The clone is broad, coherent, and executable. It covers many core Mailchimp workflows well enough to be called a **strong product replica for its declared internal scope**. But against the **current real Mailchimp product footprint**, the remaining delta is not trivial. The largest remaining gaps are not just scale count; they are **product depth gaps** in high-visibility surfaces that current Mailchimp emphasizes.

This roadmap therefore tracks **every currently identified gap** from the audit and expands them into concrete missing sub-surfaces, likely repo targets, and proof requirements.

---

# Gap 1 — Website Builder Depth

## Why this is a real gap

**Observed local coverage:**
- Strong hosted forms and landing pages in `packages/app/routes/forms.mjs`
- Public hosted form route `/f/:slug`
- Public landing page route `/lp/:slug`

**Observed weakness:**
- I did **not** find an equally first-class multi-page website builder surface in the authenticated app route family
- The repo exposes forms + landing pages well, but that is not the same as Mailchimp's broader website-building product surface

## Current local evidence that this is under-modeled
- `forms.mjs` supports:
  - form creation
  - field management
  - publish/unpublish
  - landing page CRUD and hosting
- I did **not** find a dedicated route family like:
  - `/websites`
  - `/websites/:id/builder`
  - `/websites/:id/pages`
  - `/websites/:id/theme`
  - `/websites/:id/navigation`

## Missing sub-surfaces

### 1.1 Site object model
- website records separate from landing pages
- site-level settings:
  - site name
  - default domain / subdomain
  - favicon
  - theme
  - sitewide SEO metadata
  - brand tokens / typography presets
  - global analytics settings
- page hierarchy beneath the site

### 1.2 Multi-page site builder
- home/about/contact/store-style page shells
- reusable header/footer/navigation blocks
- page duplication
- page reorder / hierarchy
- draft vs published site/page state
- page slug collision handling
- navigation visibility toggles

### 1.3 Sitewide style system
- theme presets
- global color + typography system
- reusable section styles
- sitewide button style tokens
- global image / hero defaults

### 1.4 Website-specific content blocks
- hero variants
- testimonials
- FAQ blocks
- galleries
- map/location blocks
- embedded scheduling/contact blocks
- sitewide newsletter subscribe blocks
- promo ribbons / announcement bars

### 1.5 SEO + discoverability
- page title / meta description editing
- social preview / OG metadata
- sitemap generation
- robots/indexing settings
- canonical URL handling

### 1.6 Domain + publish model
- website-specific publish workflow
- connect custom domain to site, not just sending domain
- domain verification / preview / rollback behavior
- site-level publish history

### 1.7 Website analytics and funneling
- page-level analytics
- referrer/source breakdown
- click heat / CTA breakdown (even if modeled simply)
- per-page signup attribution back into audience/campaign flows

### 1.8 Commerce / appointment / lead-capture adjacency
- site pages that can embed:
  - forms
  - signup CTAs
  - commerce CTA/product grid
  - booking/contact request blocks
- current Mailchimp positioning suggests broader site-to-marketing continuity than simple landing pages alone

## Likely repo targets
- new route family, probably something like:
  - `packages/app/routes/websites.mjs`
- new domain layer:
  - `packages/app/domain-website-builder.mjs` or equivalent
- shared rendering / theme helpers
- updates to `apps/web/server.mjs` route registration
- new tests:
  - `tests/website-builder.test.mjs`
  - browser-realism additions for site publish/edit/nav/theme flows
- smoke expansion:
  - website create → page edit → publish → public render → analytics attribution

## Parity proof required
- create website
- create multiple pages
- configure navigation
- update global theme
- publish website
- render public website path(s)
- verify analytics or attribution moves
- browser-visible walkthrough proving the site builder is distinct from landing pages

---

# Gap 2 — AI / Generative Marketing Assistance

## Why this is a real gap

Current Mailchimp product framing leans heavily on AI-assisted marketing workflows. The clone has an app called `intelligence-works`, but the main product-surface evidence does **not** yet clearly show first-class Mailchimp-style AI helper workflows in the core app shell.

## Current local evidence that this is weaker than real Mailchimp
- I did not find clear first-class route surfaces for:
  - subject line generator
  - preheader generator
  - generative email draft assistant
  - AI segmentation recommendations
  - AI journey recommendations
  - AI creative assistance embedded in the main editor flow

## Missing sub-surfaces

### 2.1 Subject line + preheader assistants
- generate multiple subject line variants
- tune by tone / goal / campaign type
- score recommendations or explain tradeoffs
- save generated variants directly into campaign setup

### 2.2 AI email copy assistant
- generate headline/body/button variants for email blocks
- rewrite existing block content
- shorten/expand tone operations
- CTA suggestion
- brand-voice-aware generation

### 2.3 AI landing/website copy assistance
- generate landing page headlines/body/CTA
- generate site section copy
- rewrite public page content for conversion goals

### 2.4 Audience intelligence assistance
- recommend segments to target
- suggest tags/interests
- identify likely re-engagement groups
- recommend exclusion groups for fatigue/compliance

### 2.5 Journey optimization assistance
- recommend automation entry triggers
- suggest node sequencing
- suggest delays/branching based on goals
- flag automation gaps / dead-end paths

### 2.6 Creative intelligence
- content block recommendations by campaign goal
- asset recommendations from content studio
- template recommendations based on industry/objective

### 2.7 AI explanation / operator trust surface
- show why a suggestion was made
- show source context for recommendation inputs
- allow acceptance / editing / rejection logging
- audit trail for generated content use

### 2.8 Governance / policy
- workspace-level AI enable/disable
- human review markers for generated content
- audit metadata on generated artifacts

## Likely repo targets
- campaign setup/editor routes in `packages/app/routes/campaigns.mjs`
- automation route flow in `packages/app/routes/automations.mjs`
- content route in `packages/app/routes/content-asset-templates.mjs`
- possibly `apps/intelligence-works/*` plus app-shell integration back into `/campaigns`, `/automations`, `/content`
- new domain helper(s) for generative recommendation objects and audit logging
- tests:
  - `tests/ai-marketing-assist.test.mjs`
  - browser realism covering subject line generation and block rewriting

## Parity proof required
- AI suggestions visible in campaign builder
- suggestions accepted into saved campaign/automation state
- audit trail present
- operator can compare/edit/reject suggestions
- browser proof of at least subject line + content block + journey recommendation flows

---

# Gap 3 — Experimentation / A/B / Dynamic Content Depth

## Why this is a real gap

The clone has solid campaign/reporting infrastructure, but current real-product parity needs stronger experimentation depth than a linear campaign wizard plus reports.

## Current local evidence that this is weaker than real Mailchimp
- `campaigns.mjs` exposes setup → recipients → template → editor → review
- reports expose drilldowns
- I did **not** find clearly first-class campaign experiment route families or multivariate orchestration surfaces

## Missing sub-surfaces

### 3.1 Campaign A/B testing model
- define experiment object distinct from a normal campaign
- variant creation and naming
- winner metric selection:
  - open rate
  - click rate
  - revenue
  - manual winner
- traffic split controls
- test duration / winner selection timing

### 3.2 Multivariate depth
- subject-only experiments
- from-name experiments
- content/body experiments
- send-time experiments
- combinations of multiple axes

### 3.3 Holdouts and control groups
- reserve control cohort
- compare experimental vs baseline cohorts
- persist experiment/control attribution in reporting

### 3.4 Dynamic content rules
- conditional block visibility by:
  - tag
  - segment
  - interest
  - geography or derived audience traits
- preview content variants by persona/segment
- rule conflict handling

### 3.5 Experiment lifecycle
- draft / running / concluded / promoted statuses
- promote winner into canonical campaign
- archive variants while retaining reporting lineage

### 3.6 Experiment reporting
- confidence / significance-like result framing
- winning-variant explanation
- side-by-side metric table
- historical experiment archive

### 3.7 Editor integration
- variant-aware editor
- content diff or compare view between variants
- duplicated blocks/variants with provenance

## Likely repo targets
- `packages/app/routes/campaigns.mjs`
- `packages/app/routes/reports.mjs`
- new domain layer under campaigns/experimentation
- possible expansion of content template/block data model
- tests:
  - `tests/campaign-experimentation.test.mjs`
  - browser-realism experiment authoring flow

## Parity proof required
- create A/B experiment
- create and edit variants
- run experiment
- produce experiment report
- promote winner
- verify dynamic content preview in editor or public preview state

---

# Gap 4 — Predictive Optimization / Targeting / Recommendation Depth

## Why this is a real gap

The clone already hints at predictive/optimization territory (for example, `predictive-segments` and `send-time-optimizer` references), but current real Mailchimp parity needs those to feel like first-class product capabilities, not just adjacent scale-wave artifacts.

## Current local evidence that this is weaker than real Mailchimp
- `expansion-showcase.mjs` references `send-time-optimizer`
- `scale-wave-six.mjs` references `predictive-segments`
- I did **not** verify equally first-class integrated product surfaces with deep visible workflows in the main app shell

## Missing sub-surfaces

### 4.1 Send-time optimization as a real campaign feature
- campaign-level STO toggle
- recommended send window
- explanation for recommendation
- historical STO performance reporting

### 4.2 Predictive audience scores
- likelihood to open / click / purchase / churn / re-engage
- per-contact score fields
- segment builder access to predictive fields
- audience list filters by predictive score bands

### 4.3 Product / content recommendations
- recommend products/content blocks by audience behavior or commerce history
- campaign editor insertion workflow for recommended blocks

### 4.4 Journey optimization recommendations
- next-best action suggestions
- skip / branch recommendations
- fatigue / over-send warnings
- re-entry optimization suggestions

### 4.5 Budget / revenue optimization
- recommended budget or channel emphasis
- recommended conversion objective for campaigns/ads
- revenue-lift estimate framing

### 4.6 Frequency / fatigue controls
- send frequency recommendations
- suppression or cool-down suggestions
- conflict warnings across campaigns/journeys

### 4.7 Predictive reporting surfaces
- dashboard tiles for predictive segments
- compare actual vs predicted behavior
- predictive model provenance / recency indicator

## Likely repo targets
- campaign routes/editor/review
- audience and segment routes
- reports overview and drilldowns
- likely domain additions in predictive-segment / optimization packages already present in the repo
- tests:
  - `tests/predictive-optimization.test.mjs`

## Parity proof required
- predictive scores visible on contacts/segments
- campaign or automation can consume predictive logic
- optimization recommendations show in product shell
- reports expose predictive/optimization outcomes

---

# Gap 5 — Ads / Social / Omnichannel Depth

## Why this is a real gap

The clone covers messaging-retention-related continuation surfaces, but current Mailchimp parity implies broader omnichannel marketing depth than email + journeys + inbox alone.

## Current local evidence that this is weaker than real Mailchimp
- I found strong email / automation / forms / inbox / preferences / surveys surfaces
- I did **not** find equally strong first-class route families for digital ads management, stronger social planning/publishing, or a clearly modeled SMS surface in the main app shell

## Missing sub-surfaces

### 5.1 Digital ads / retargeting
- ads audience sync
- campaign-to-ad audience reuse
- retargeting audience creation
- ad creative/state objects
- ad performance reporting linked back to campaigns/audiences

### 5.2 Social publishing / social calendar
- social post composer
- scheduled social calendar
- linked campaign/social coordination
- cross-channel performance timeline

### 5.3 SMS / mobile channel
- SMS campaign object
- SMS compliance settings
- audience phone/channel consent handling
- SMS-in-journey actions
- cross-channel orchestration with email + SMS

### 5.4 Cross-channel journey builder
- automation nodes for:
  - email
  - SMS
  - ad audience sync
  - inbox/conversation tasks
  - survey request
- channel-specific performance rollups

### 5.5 Omnichannel reporting
- channel mix dashboard
- performance by channel / objective
- attributed conversions by touchpoint/channel

### 5.6 Audience consent and channel preferences
- preference center richer channel settings
- consent state for email vs SMS vs ads audiences
- per-channel opt-in/out history

## Likely repo targets
- new route families likely needed:
  - `packages/app/routes/ads-social.mjs`
  - `packages/app/routes/sms.mjs`
- expansion of `automations.mjs`, `reports.mjs`, `audience.mjs`, `preferences center` surfaces
- domain/channel-specific models and reporting state
- tests:
  - `tests/omnichannel-marketing.test.mjs`
  - browser proof for channel setup + journey actions + reports

## Parity proof required
- create multi-channel campaign assets
- run at least one email + secondary-channel workflow
- preference center reflects channel controls
- reports show channel-specific outcomes

---

# Gap 6 — Content Studio / Asset Workflow Depth

## Why this is a real gap

This is **not absent**. There is already a content studio surface, brand kit, saved templates, asset collections, and stored assets. But current Mailchimp parity likely needs significantly richer asset/workflow depth than what is currently exposed.

## Current local evidence already present
- `packages/app/routes/content-asset-templates.mjs`
- `/content` with:
  - brand kit
  - reusable templates
  - asset collections
  - connected assets listing
- `/assets` in `platform.mjs`

## Why this is still a gap
The current implementation looks more like a strong template/assets starter system than a Mailchimp-grade content studio with full reuse, workflow, and creative-ops depth.

## Missing or weaker sub-surfaces

### 6.1 Asset management depth
- folders/subfolders beyond a single folder field
- tags / labels / search facets
- usage lineage across campaigns/pages/automations
- richer metadata for rights/source/license
- archived/deleted states

### 6.2 Image/media handling
- image transformations
- crop / focal point / aspect presets
- alt-text workflow
- thumbnails / preview assets
- media variants by channel

### 6.3 Reusable content system depth
- saved sections / snippets / partials
- shared reusable blocks across campaigns and pages
- block inheritance or update propagation
- template/version lineage

### 6.4 Collaboration and approval around assets
- draft/approved/archived lifecycle for templates/assets
- content approval workflows
- comments / change requests on reusable content

### 6.5 Search/discovery
- content search
- asset filtering by type/tag/use case
- recommended assets/templates based on campaign goal

### 6.6 Content governance
- lock certain brand elements
- enforce approved brand kit variants
- prevent unapproved assets in campaign send review

### 6.7 Content performance linkage
- show asset/template reuse performance
- identify high-performing blocks/templates
- tie content pieces to report outcomes

## Likely repo targets
- `packages/app/routes/content-asset-templates.mjs`
- `packages/app/routes/platform.mjs` asset manager
- campaign editor in `packages/app/routes/campaigns.mjs`
- collaboration approvals in `packages/app/routes/collaboration-approval.mjs`
- new domain models for asset metadata/versioning/reuse lineage
- tests:
  - `tests/content-studio-depth.test.mjs`

## Parity proof required
- searchable asset library
- reusable content block/snippet workflow
- asset/version/approval state transitions
- content performance linkage visible in reports or content studio dashboards

---

# Gap 7 — Marketplace Ecosystem Realism / Integration Depth

## Why this is a real gap

The clone **does** have an integrations marketplace and sync history. This is a strength. The gap is not presence; it is **ecosystem realism depth** relative to real Mailchimp.

## Current local evidence already present
- `packages/app/routes/integrations-marketplace.mjs`
- installable marketplace apps
- installed connector list
- sync runs / summary
- commerce connector surfaces in `commerce-revenue.mjs`

## Why this is still a gap
The existing marketplace looks more like a high-quality synthetic marketplace shell than a deeply realistic connector ecosystem with connector-specific behavior, configuration edge cases, mapping, error remediation, and operational depth.

## Missing or weaker sub-surfaces

### 7.1 OAuth / auth realism
- connector-specific auth flows
- credential refresh / expiry handling
- reconnect flows
- permission scope variance across connectors

### 7.2 Connector-specific configuration pages
- Shopify-specific settings
- Salesforce-specific field/object mapping
- Zapier / webhook-style integration controls
- Meta/Google-style audience sync configuration

### 7.3 Field mapping and schema mediation
- field mapping UI
- conflict resolution
- custom field transforms
- source-of-truth configuration
- identity matching strategy

### 7.4 Sync depth and remediation
- initial backfill vs incremental sync
- failed sync inspection
- retry queues
- row-level sync errors
- reprocess single object / batch

### 7.5 Marketplace operations realism
- versioned connectors
- install/uninstall lifecycle
- health status / degraded connectors
- webhook subscription management
- API quota / throttle visibility

### 7.6 Ecosystem breadth realism
- connector-specific entity types:
  - products
  - carts
  - orders
  - subscriptions
  - support tickets
  - CRM leads/opportunities
  - ad audiences
- richer partner categories than simple installed-app counts

### 7.7 Reporting linkage
- connector contribution to audience growth / revenue / campaign attribution
- connector-specific sync performance dashboards

### 7.8 Developer / partner depth
- public developer docs are present in app structure, but ecosystem parity likely needs:
  - app registration
  - webhook docs
  - sandbox/test credentials
  - partner review / publish lifecycle

## Likely repo targets
- `packages/app/routes/integrations-marketplace.mjs`
- `packages/app/routes/commerce-revenue.mjs`
- likely connector/domain packages for each major integration class
- `apps/integrations-studio`
- `apps/developer-portal`
- tests:
  - `tests/integration-ecosystem-depth.test.mjs`
  - smoke for install → auth/configure → sync → error → remediate

## Parity proof required
- at least several connector-specific config/auth flows
- visible field mapping/remediation UI/state
- richer sync history and error recovery
- developer/partner lifecycle proof for marketplace apps

---

# Cross-Cutting Missing Depth

These are not separate top-level gaps, but they amplify almost every gap above.

## A. Browser-realism depth
Even where product surfaces exist, current real-product parity needs stronger browser-visible proof for:
- authoring flows
- preview flows
- publish flows
- error/remediation flows
- connector configuration flows
- asset workflow flows
- experiment management flows

## B. Scale realism
The product shell is broad, but some areas still look like curated surface coverage rather than Mailchimp-scale depth.
Missing signals include:
- broader fixture realism
- larger connector/entity variety
- richer history state
- more diverse regression coverage per surface

## C. Visual fidelity / interaction depth
The repo has strong functional shell coverage. But current-product parity would likely require:
- closer interaction density
- richer editor affordances
- more polished management dashboards
- higher-fidelity publish/review/reporting UX

## D. Operational edge cases
True parity needs more handling for:
- publish rollback
- connector auth expiry
- experiment invalidation
- content approval rejection loops
- domain/DNS verification edge cases
- channel-specific compliance failures

---

# Priority Order

## Priority 1 — Highest user-visible delta vs real Mailchimp
1. **Website builder depth**
2. **AI / generative marketing assistance**
3. **Experimentation / A/B / dynamic content**

## Priority 2 — Strong product differentiation / modern parity delta
4. **Predictive optimization / targeting**
5. **Ads / social / omnichannel depth**

## Priority 3 — Depth upgrades to already-good surfaces
6. **Content studio / asset workflow depth**
7. **Marketplace ecosystem realism**

---

# Recommended Program Structure

## Program A — Website + Content Expansion
- website builder
- content studio depth
- shared theme/asset/component model

## Program B — AI + Optimization Layer
- AI generation
- optimization recommendations
- predictive scoring

## Program C — Campaign Experimentation + Omnichannel
- experiments
- dynamic content
- ads/social/SMS extensions

## Program D — Ecosystem Realism
- integration config/auth depth
- field mapping/remediation
- developer/partner lifecycle

---

# Machine-Checkable Completion Expectations

For each gap family above, do **not** mark it complete unless all three are true:

1. **Product-surface diff proof**
   - real route/domain/app files changed
   - not just docs/tests/artifacts

2. **Executable validation**
   - route/domain tests exist and pass
   - smoke or browser proof exists for the major user flow

3. **Parity evidence**
   - refreshed gap matrix marks sub-surfaces complete
   - final report explicitly distinguishes observed proof from inference

---

# Final Honest Summary

The Mailchimp clone is already a strong broad replica.
What is still missing is **not the basic Mailchimp skeleton**.
What is still missing is the set of **modern, high-depth, current-product parity surfaces** that make real Mailchimp feel like more than an email/automation/forms/reports platform:

- true website-building depth
- AI-assisted marketing workflows
- experimentation depth
- predictive optimization depth
- omnichannel marketing depth
- richer content-studio operations
- connector ecosystem realism

Those are the gaps this roadmap is intended to close.
