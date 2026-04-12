# Mailchimp canonical parity audit - 2026-04-11

This is the single active source of truth for Mailchimp parity planning in this workspace.

## Executive truth

- This audit compares the current clone against the real, large-scale Mailchimp product as an externally visible and operationally broad system, not just a narrow scoped campaign matrix.
- The recent green campaigns fixed truth/reconciliation and reused carried-forward proof state, but they did **not** credibly move the clone from 1.5% to 30% or higher deep whole-product parity.
- The latest strict product-parity campaign completed in about **21 seconds** and merged **0 patches**. That is not consistent with a major real-product parity jump.
- Recent product-side diff was only about **net +28 product lines across 6 product-like files**. Most recent work was scripts/tests/control-plane.
- Canonical deep-parity estimate after this corrective audit: **8% to 15%**, confidence **low**.

## Method

Only the following count as direct evidence in this audit:

- direct product files in `packages/app` or `apps/*` that clearly implement a named user-facing surface
- targeted product tests that exercise that surface directly

The following do **not** count toward deep product parity here:

- campaign-green status
- notifier/supervisor/control-plane artifacts
- proof-path fixes
- generic shell/workflow presence without depth
- carried-forward focus completion with zero merged product patches

## Why the recent 30% implication was wrong

- 21-second runtime
- 0 merged patches in the latest green run
- tiny recent product diff
- large recent non-product diff
- carried-forward completion state reused by the campaign
- open gap families still contradict depth parity in several major subsystems

## Surface-by-surface ledger

Legend:

- `observed_direct`: direct targeted evidence exists, but not necessarily deep parity
- `partial_or_shallow`: some direct evidence exists, but depth is clearly incomplete or contradicted by open gaps
- `no_direct_evidence`: no strong direct product evidence found for this surface in the current repo/test set

### 1. Signup and onboarding wizard (`signup_onboarding`)

- **Purpose:** Turn a new visitor into a configured workspace with enough profile data to send a first campaign.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/index.mjs`, `packages/app/routes/public.mjs`, `packages/app/routes/platform.mjs`, `packages/app/view.mjs`
- **Targeted tests observed:** `tests/platform-spine.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Expand onboarding beyond happy-path account creation into a multi-step production-style wizard with industry/use-case branching, suggested defaults, skipped-step recovery, import prompts, and contextual education.
  - Add password reset, email verification, abandoned signup recovery, invite-based onboarding, and workspace bootstrap parity.
  - Match validation/error states, loading states, instrumentation, and retry/resume behavior across the full onboarding funnel.

### 2. Account workspace setup (`account_workspace_setup`)

- **Purpose:** Configure sender identity, business details, defaults, and compliance settings for the workspace.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/index.mjs`, `packages/app/routes/platform.mjs`, `packages/app/view.mjs`
- **Targeted tests observed:** `tests/platform-spine.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Implement richer workspace setup assistants for brand assets, sender settings, contact imports, audience defaults, and compliance acknowledgements.
  - Add organization/workspace switching, account handoff, ownership transfer, and migration/import tooling depth.
  - Match initial empty-state UX, first-use education, seeded recommendations, and role-based setup differences.

### 3. Dashboard / home (`dashboard_home`)

- **Purpose:** Summarize account health and provide entry points into campaigns, audience growth, and recommendations.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/index.mjs`, `packages/app/view.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests observed:** `tests/platform-spine.test.mjs`, `tests/parity-route-aliases.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Match the real dashboard widget system, personalization, KPI cards, task queues, and insight prioritization.
  - Add role-aware dashboard composition for owners, marketers, analysts, developers, and support/admin personas.
  - Deepen data freshness, drill-through behaviors, saved views, and onboarding-to-dashboard continuity.

### 4. Audience overview (`audience_overview`)

- **Purpose:** Present top-level audience inventory, growth, and management actions.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests observed:** `tests/audience-core.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen audience summary cards, health metrics, import/export history, suppression status, and lifecycle insights.
  - Add richer overview drill-downs and action flows tied to segments, campaigns, automations, and commerce events.

### 5. Contacts table (`contacts_table`)

- **Purpose:** List and filter audience members with bulk actions.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests observed:** `tests/audience-core.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Match full contacts-table parity: bulk actions, saved columns, sorting, filters, pagination, imports, exports, and merge/dedup flows.
  - Deepen profile row actions, consent/suppression states, tags/groups/interests visibility, and contact timeline integration.

### 6. Contact profile (`contact_profile`)

- **Purpose:** Show one contact’s attributes, activity history, and editable metadata.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests observed:** `tests/audience-core.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Implement a full contact profile with activity timeline, campaign history, automation participation, ecommerce history, notes, and custom fields.
  - Add editing, auditability, source attribution, suppression/consent controls, and related segment/journey visibility.

### 7. Tags, groups, and interests management (`tags_groups_interests`)

- **Purpose:** Represent audience classification primitives used for targeting and preference management.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests observed:** `tests/audience-core.test.mjs`, `tests/audience-funnels.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen tag/group/interest creation, hierarchy management, assignment at scale, import/export support, and reporting integration.
  - Match Mailchimp-style audience organization workflows including bulk editing, automated assignment, and segment-builder integration.

### 8. Segments (`segments`)

- **Purpose:** Define reusable filters for audience targeting.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests observed:** `tests/audience-funnels.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Expand segment grammar to include richer boolean logic, temporal filters, predictive clauses, and reusable saved segment patterns.
  - Match live audience counts, preview samples, eligibility explanations, and segment-to-campaign/journey handoff UX.

### 9. Signup forms and popup forms (`signup_forms_popups`)

- **Purpose:** Collect new leads and subscription preferences through embeddable or hosted capture surfaces.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-leads.mjs`, `packages/app/routes/leads.mjs`
- **Targeted tests observed:** `tests/forms-landing.test.mjs`
- **Open gap families touching this surface:** `omnichannel_depth`
- **What still needs to be done for 100% parity:**
  - Deepen embedded, popup, modal, and hosted signup forms with targeting rules, scheduling, analytics, and branding/theming parity.
  - Add publish lifecycle controls, placement management, consent/compliance states, and audience/journey integration depth.

### 10. Campaign index (`campaign_index`)

- **Purpose:** Provide list, filtering, lifecycle status, and duplication/archive actions for campaigns.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests observed:** `tests/campaign-editor-depth.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Match campaign list depth: filtering, saved views, statuses, schedules, approvals, folders, duplication, archiving, and batch actions.
  - Add richer historical context, ownership/approval metadata, and multi-channel campaign visibility.

### 11. Campaign creation wizard (`campaign_wizard`)

- **Purpose:** Capture high-level campaign metadata before design and send.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests observed:** `tests/campaign-editor-depth.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families touching this surface:** `experimentation_depth`
- **What still needs to be done for 100% parity:**
  - Deepen campaign creation flows for regular, automated, RSS, transactional-adjacent, and multivariate campaign types.
  - Match recipient selection, scheduling, approvals, compliance checks, send-time optimization, and review/send workflows.

### 12. Email builder (`email_builder`)

- **Purpose:** Assemble message content with block editing, styling, previewing, and asset use.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`, `packages/app/routes/templates.mjs`
- **Targeted tests observed:** `tests/campaign-editor-depth.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen the email builder block system, drag/drop editing, merge tags, conditional content, previews, testing, and collaboration.
  - Match content reuse, asset linking, brand kits, render fidelity, and responsive preview parity.

### 13. Template library (`template_library`)

- **Purpose:** Offer reusable starting points for campaigns and saved custom layouts.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/templates.mjs`, `packages/app/domain-campaigns.mjs`
- **Targeted tests observed:** `tests/template-variants-routes.test.mjs`, `tests/template-approvals-routes.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Match template gallery taxonomy, previews, filtering, ownership, permissions, approvals, and brand/template inheritance.
  - Add true template lifecycle management, versioning, duplication, review, and dependency tracking.

### 14. Content studio / asset manager (`content_studio`)

- **Purpose:** Store and retrieve reusable images or creative assets used across campaigns.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/content-library.mjs`, `packages/app/routes/content-ops.mjs`
- **Targeted tests observed:** `tests/content-library.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families touching this surface:** `content_studio_depth`
- **What still needs to be done for 100% parity:**
  - Implement full asset-library depth: folders, metadata, search, tagging, previews, image editing, approvals, and reuse workflows.
  - Match cross-surface content insertion, locking, collaboration, and auditability across campaigns, templates, sites, and automations.

### 15. Send / schedule / review (`send_schedule_review`)

- **Purpose:** Review a draft campaign, run preflight checks, send test messages, and schedule delivery.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests observed:** `tests/campaign-editor-depth.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen send/review parity: audience checks, compliance warnings, subject/preheader validation, render previews, approval gates, and schedule optimization.
  - Add send-window constraints, timezone behavior, retry/cancel/edit-after-schedule flows, and audit history.

### 16. Reports overview (`reports_overview`)

- **Purpose:** Aggregate recent campaign, automation, and audience performance metrics.
- **Status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/routes/reports.mjs`, `packages/app/routes/api-admin.mjs`
- **Targeted tests observed:** `tests/reports-admin.test.mjs`, `tests/billing-analytics.test.mjs`
- **Open gap families touching this surface:** `predictive_optimization_depth`
- **What still needs to be done for 100% parity:**
  - Match executive reporting dashboards, trend views, comparisons, benchmarks, attribution, and audience growth synthesis.
  - Add richer export/sharing/report scheduling and role-aware reporting permissions.

### 17. Report detail (`report_detail`)

- **Purpose:** Show per-campaign or per-automation performance metrics and recipient activity.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/reports.mjs`, `packages/app/domain-campaigns.mjs`
- **Targeted tests observed:** `tests/reports-admin.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families touching this surface:** `experimentation_depth`, `predictive_optimization_depth`
- **What still needs to be done for 100% parity:**
  - Implement deep single-campaign and journey detail reports: engagement, revenue attribution, cohorting, funnel analysis, and comparison views.
  - Match experiment result analysis, link-level drill-downs, device/client detail, and anomaly explanations.

### 18. Automations overview (`automations_overview`)

- **Purpose:** List, summarize, and launch automation or journey flows.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-journeys.mjs`, `packages/app/routes/automations.mjs`
- **Targeted tests observed:** `tests/automation-journeys.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Add richer automation library, health/status views, run history, template selection, analytics, and operational controls.
  - Match automation governance, ownership, approvals, and diagnostics.

### 19. Customer journey / automation builder (`automation_journey_builder`)

- **Purpose:** Visually assemble triggered multi-step workflows.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/domain-journeys.mjs`, `packages/app/routes/automations.mjs`
- **Targeted tests observed:** `tests/automation-journeys.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen journey nodes, triggers, goals, branching, delays, conditions, and debugging views to production-style breadth.
  - Match reusable journeys, testing/simulation, analytics overlays, and cross-channel actions.

### 20. Landing pages (`landing_pages`)

- **Purpose:** Create standalone conversion pages connected to audiences and campaigns.
- **Status:** `observed_direct`
- **Confidence:** `medium`
- **Product files observed:** `packages/app/routes/leads.mjs`, `packages/app/routes/websites.mjs`
- **Targeted tests observed:** `tests/forms-landing.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen landing-page builder parity: block library, page settings, SEO, experimentation, analytics, and publish lifecycle.
  - Match domain mapping, asset management, duplication, templates, and conversion reporting.

### 21. Website builder (`website_builder`)

- **Purpose:** Manage broader hosted web presence beyond standalone landing pages.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/websites.mjs`, `packages/app/domain-commerce-revenue.mjs`
- **Targeted tests observed:** `tests/current-product-parity.test.mjs`
- **Open gap families touching this surface:** `website_builder_depth`
- **What still needs to be done for 100% parity:**
  - Implement a distinct website object model with navigation, theme system, pages/blog/store depth, publish workflow, and analytics.
  - Match reusable sections, domain management, SEO, commerce embedding, and site-wide asset/content management.

### 22. Integrations marketplace (`integrations_marketplace`)

- **Purpose:** Discover and manage connected apps such as Shopify, Salesforce, Zapier, and analytics tools.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/integrations.mjs`, `packages/app/domain-custom-journeys.mjs`
- **Targeted tests observed:** `tests/integrations-marketplace.test.mjs`
- **Open gap families touching this surface:** `integration_ecosystem_realism`
- **What still needs to be done for 100% parity:**
  - Deepen real integration lifecycle: discovery, auth/install, sync controls, settings, health, error handling, and uninstall/reconnect behavior.
  - Expand catalog realism, partner metadata, and data sync depth across commerce, CRM, ads, analytics, and support systems.

### 23. API keys and webhooks (`api_keys_webhooks`)

- **Purpose:** Expose developer-oriented access and event wiring surfaces.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/api-admin.mjs`
- **Targeted tests observed:** `tests/reports-admin.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Build a full developer/admin surface for API keys, scopes, revocation, rotation, webhook endpoints, event subscriptions, and logs.
  - Add webhook delivery history, retry controls, secrets management, and app-level developer tooling/documentation links.

### 24. Billing and plans (`billing_plans`)

- **Purpose:** Handle subscriptions, payment methods, usage meters, and plan-gated upsells.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/api-admin.mjs`, `packages/app/domain-commerce-revenue.mjs`
- **Targeted tests observed:** `tests/billing-analytics.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Deepen plan/entitlement parity, invoice history, usage tracking, upgrade/downgrade, trials, and billing administration flows.
  - Match billing edge cases, taxation, payment recovery, seat/usage visibility, and role-based billing permissions.

### 25. Settings, domains, and authentication (`settings_domains`)

- **Purpose:** Manage account-level defaults, sender authentication, and connected domains.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/routes/api-admin.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests observed:** `tests/security-ops-hardening.test.mjs`, `tests/platform-spine.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Expand settings parity across domains, sender reputation, authentication, DNS, branding, notifications, and regional/compliance settings.
  - Match verification flows, failure recovery, admin controls, and auditability for domain and account settings changes.

### 26. Team users, roles, and permissions (`team_roles_permissions`)

- **Purpose:** Invite collaborators and enforce scoped access across account surfaces.
- **Status:** `partial_or_shallow`
- **Confidence:** `low`
- **Product files observed:** `packages/app/domain-notes.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests observed:** `tests/platform-spine.test.mjs`
- **Open gap families touching this surface:** none explicitly linked
- **What still needs to be done for 100% parity:**
  - Implement full team/org/workspace permission parity including invite lifecycle, custom roles, scoped permissions, approvals, and admin views.
  - Add audit trails, permission inheritance, ownership transfer, and enterprise organization controls.

## Cross-cutting work required for 100% parity beyond the coarse 26-surface map

- Deliverability and sending infrastructure: queues, throughput shaping, suppression pipelines, bounce/complaint processing, sender reputation, warmup, and compliance enforcement.
- Data platform and event ingestion: high-volume click/open/site/commerce event collection, retention, indexing, backfill, and report recomputation.
- Abuse and fraud controls: account risk, sending review, domain trust, webhook abuse, signup abuse, content checks, and sanctions/compliance workflows.
- Enterprise identity and governance: SSO, SCIM, org hierarchies, admin policy, audit exports, delegated administration, and region controls.
- Billing/entitlements platform: plans, feature flags, trials, usage meters, invoicing, taxes, collections, and entitlement propagation.
- Experimentation platform: experiment config, traffic allocation, result stats, guardrails, stopping rules, and reporting.
- Predictive/ML systems: recommendations, forecast models, content scoring, send-time optimization, churn/CLV/probability models, and model ops.
- Omnichannel orchestration: SMS, ads, social, surveys, push/mobile tie-ins, and cross-channel reporting/journey actions.
- Content/design system depth: drag/drop blocks, responsive rendering fidelity, brand kits, reusable sections, versioning, and approvals.
- Integration ecosystem breadth: partner SDK patterns, auth variants, sync monitoring, field mapping, schema evolution, and support workflows.
- Support and help surfaces beyond current map: contextual help, guided setup, searchable knowledge, ticketing/escalation, and diagnostics.
- Mobile-specific parity: mobile workflows, push notifications, approvals, dashboard/report consumption, and edit/send/admin flows on mobile.
- Performance, scale, and multi-tenant hardening: caching, background jobs, data partitioning, migrations, failure recovery, and rate limiting.
- Observability and ops tooling: admin consoles, replay/debugging, alerting, runbooks, audit logs, and customer support tooling.
- Localization, accessibility, and compliance depth across all product surfaces.

## Counts

- `observed_direct`: 7
- `partial_or_shallow`: 19
- `no_direct_evidence`: 0

## Correct conclusion

- The repo is clearly beyond a trivial stub, but the current evidence does **not** support a 30% deep whole-product parity claim.
- The most defensible current read is that deep parity is still in the **single digits to low teens**.
- This document and the companion JSON matrix are the canonical parity sources going forward.

- Canonical audit: `/root/clawd/mailchimp-clone/docs/MAILCHIMP_CANONICAL_PARITY_AUDIT_2026-04-11.md`
- Canonical matrix: `/root/clawd/mailchimp-clone/docs/MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json`
