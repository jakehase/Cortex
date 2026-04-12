# Mailchimp canonical parity execution backlog - 2026-04-11

This is the execution backlog derived from the canonical audit and canonical matrix.

## Source of truth

- Canonical audit: `/root/clawd/mailchimp-clone/docs/MAILCHIMP_CANONICAL_PARITY_AUDIT_2026-04-11.md`
- Canonical matrix: `/root/clawd/mailchimp-clone/docs/MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json`
- Target fidelity: `full_clone`
- Current defensible deep-parity estimate: **8% to 15%**, confidence **low**

## Execution rules

- Do not use campaign green status, supervisor state, or proof-path artifacts as substitutes for direct product parity evidence.
- Do not collapse this backlog into a smaller MVP without explicitly relabeling fidelity.
- Treat the canonical audit and canonical matrix as the only source-of-truth inputs for parity planning unless superseded by a later canonical audit.
- When a surface is claimed complete, direct product files and targeted tests must substantiate the claim.

## Wave plan

### Core funnel, workspace bootstrap, and audience management (wave_1_core_funnel_and_audience)

- **Why this wave exists:** These surfaces form the first-run path from signup through audience readiness. Without them, downstream campaign/reporting parity is cosmetic.
- **Surfaces in wave:**
  - `signup_onboarding` (Signup and onboarding wizard) — P0, current status `partial_or_shallow`, confidence `medium`
  - `account_workspace_setup` (Account workspace setup) — P0, current status `partial_or_shallow`, confidence `medium`
  - `dashboard_home` (Dashboard / home) — P1, current status `partial_or_shallow`, confidence `medium`
  - `audience_overview` (Audience overview) — P0, current status `observed_direct`, confidence `medium`
  - `contacts_table` (Contacts table) — P0, current status `observed_direct`, confidence `medium`
  - `contact_profile` (Contact profile) — P0, current status `partial_or_shallow`, confidence `low`
  - `tags_groups_interests` (Tags, groups, and interests management) — P1, current status `partial_or_shallow`, confidence `low`
  - `segments` (Segments) — P0, current status `observed_direct`, confidence `medium`
- **Wave completion criteria:**
  - New-account flow works end to end with resume/recovery behavior and richer setup branching.
  - Audience management reaches Mailchimp-like daily-operational depth, not just route presence.
  - Every surface has direct product tests for happy path, edge cases, and administrative workflows.

### Campaign authoring, content systems, forms, and send/review (wave_2_campaign_authoring_content_and_send)

- **Why this wave exists:** This is the revenue-critical middle of Mailchimp: authoring campaigns, designing content, collecting leads, and actually reviewing/sending.
- **Surfaces in wave:**
  - `signup_forms_popups` (Signup forms and popup forms) — P1, current status `observed_direct`, confidence `medium`, gap families: omnichannel_depth
  - `campaign_index` (Campaign index) — P0, current status `partial_or_shallow`, confidence `medium`
  - `campaign_wizard` (Campaign creation wizard) — P0, current status `partial_or_shallow`, confidence `medium`, gap families: experimentation_depth
  - `email_builder` (Email builder) — P0, current status `partial_or_shallow`, confidence `medium`
  - `template_library` (Template library) — P1, current status `partial_or_shallow`, confidence `low`
  - `content_studio` (Content studio / asset manager) — P1, current status `partial_or_shallow`, confidence `low`, gap families: content_studio_depth
  - `send_schedule_review` (Send / schedule / review) — P0, current status `partial_or_shallow`, confidence `low`
- **Wave completion criteria:**
  - Users can create, design, preview, review, schedule, and send campaigns with production-style guardrails.
  - Templates, content assets, and forms behave as reusable systems rather than thin route demos.
  - Campaign build/test/send lifecycle is backed by direct product tests and realistic UX states.

### Reporting, automations, landing pages, and growth surfaces (wave_3_reporting_automation_and_growth)

- **Why this wave exists:** Mailchimp parity requires not only building campaigns, but understanding outcomes and orchestrating lifecycle growth journeys.
- **Surfaces in wave:**
  - `reports_overview` (Reports overview) — P0, current status `partial_or_shallow`, confidence `medium`, gap families: predictive_optimization_depth
  - `report_detail` (Report detail) — P1, current status `partial_or_shallow`, confidence `low`, gap families: experimentation_depth, predictive_optimization_depth
  - `automations_overview` (Automations overview) — P1, current status `observed_direct`, confidence `medium`
  - `automation_journey_builder` (Customer journey / automation builder) — P0, current status `observed_direct`, confidence `medium`
  - `landing_pages` (Landing pages) — P1, current status `observed_direct`, confidence `medium`
  - `website_builder` (Website builder) — P1, current status `partial_or_shallow`, confidence `low`, gap families: website_builder_depth
- **Wave completion criteria:**
  - Reporting supports detailed drill-down, attribution context, and comparison workflows.
  - Automations and journeys are deep enough for real triggered lifecycle programs.
  - Landing pages and websites move from shallow presence to durable publishing systems.

### Integrations, developer/admin tooling, billing, settings, and team governance (wave_4_admin_integrations_revenue_and_governance)

- **Why this wave exists:** The real product includes partner ecosystem, admin controls, billing, domains, auth, and collaborative governance. These are required for whole-product parity.
- **Surfaces in wave:**
  - `integrations_marketplace` (Integrations marketplace) — P2, current status `partial_or_shallow`, confidence `low`, gap families: integration_ecosystem_realism
  - `api_keys_webhooks` (API keys and webhooks) — P2, current status `partial_or_shallow`, confidence `low`
  - `billing_plans` (Billing and plans) — P2, current status `partial_or_shallow`, confidence `low`
  - `settings_domains` (Settings, domains, and authentication) — P1, current status `partial_or_shallow`, confidence `low`
  - `team_roles_permissions` (Team users, roles, and permissions) — P1, current status `partial_or_shallow`, confidence `low`
- **Wave completion criteria:**
  - Connected-app lifecycle, developer tooling, and billing/admin flows operate at product depth.
  - Settings, domains, auth, and team controls support realistic multi-user operation.
  - Enterprise and compliance-adjacent behaviors have direct proof rather than implied coverage.

## Per-surface backlog

### Signup and onboarding wizard (signup_onboarding)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Turn a new visitor into a configured workspace with enough profile data to send a first campaign.
- **Observed product files:** `packages/app/index.mjs`, `packages/app/routes/public.mjs`, `packages/app/routes/platform.mjs`, `packages/app/view.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Expand onboarding beyond happy-path account creation into a multi-step production-style wizard with industry/use-case branching, suggested defaults, skipped-step recovery, import prompts, and contextual education.
  - Add password reset, email verification, abandoned signup recovery, invite-based onboarding, and workspace bootstrap parity.
  - Match validation/error states, loading states, instrumentation, and retry/resume behavior across the full onboarding funnel.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Account workspace setup (account_workspace_setup)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Configure sender identity, business details, defaults, and compliance settings for the workspace.
- **Observed product files:** `packages/app/index.mjs`, `packages/app/routes/platform.mjs`, `packages/app/view.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Implement richer workspace setup assistants for brand assets, sender settings, contact imports, audience defaults, and compliance acknowledgements.
  - Add organization/workspace switching, account handoff, ownership transfer, and migration/import tooling depth.
  - Match initial empty-state UX, first-use education, seeded recommendations, and role-based setup differences.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Dashboard / home (dashboard_home)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Summarize account health and provide entry points into campaigns, audience growth, and recommendations.
- **Observed product files:** `packages/app/index.mjs`, `packages/app/view.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`, `tests/parity-route-aliases.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Match the real dashboard widget system, personalization, KPI cards, task queues, and insight prioritization.
  - Add role-aware dashboard composition for owners, marketers, analysts, developers, and support/admin personas.
  - Deepen data freshness, drill-through behaviors, saved views, and onboarding-to-dashboard continuity.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Audience overview (audience_overview)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** Present top-level audience inventory, growth, and management actions.
- **Observed product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen audience summary cards, health metrics, import/export history, suppression status, and lifecycle insights.
  - Add richer overview drill-downs and action flows tied to segments, campaigns, automations, and commerce events.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Contacts table (contacts_table)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** List and filter audience members with bulk actions.
- **Observed product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Match full contacts-table parity: bulk actions, saved columns, sorting, filters, pagination, imports, exports, and merge/dedup flows.
  - Deepen profile row actions, consent/suppression states, tags/groups/interests visibility, and contact timeline integration.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Contact profile (contact_profile)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Show one contact’s attributes, activity history, and editable metadata.
- **Observed product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Implement a full contact profile with activity timeline, campaign history, automation participation, ecommerce history, notes, and custom fields.
  - Add editing, auditability, source attribution, suppression/consent controls, and related segment/journey visibility.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Tags, groups, and interests management (tags_groups_interests)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Represent audience classification primitives used for targeting and preference management.
- **Observed product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`, `tests/audience-funnels.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen tag/group/interest creation, hierarchy management, assignment at scale, import/export support, and reporting integration.
  - Match Mailchimp-style audience organization workflows including bulk editing, automated assignment, and segment-builder integration.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Segments (segments)

- **Wave:** `wave_1_core_funnel_and_audience`
- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** Define reusable filters for audience targeting.
- **Observed product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-funnels.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Expand segment grammar to include richer boolean logic, temporal filters, predictive clauses, and reusable saved segment patterns.
  - Match live audience counts, preview samples, eligibility explanations, and segment-to-campaign/journey handoff UX.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Signup forms and popup forms (signup_forms_popups)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P1`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** Collect new leads and subscription preferences through embeddable or hosted capture surfaces.
- **Observed product files:** `packages/app/domain-leads.mjs`, `packages/app/routes/leads.mjs`
- **Targeted tests:** `tests/forms-landing.test.mjs`
- **Open gap families:** `omnichannel_depth`
- **Required work to reach parity:**
  - Deepen embedded, popup, modal, and hosted signup forms with targeting rules, scheduling, analytics, and branding/theming parity.
  - Add publish lifecycle controls, placement management, consent/compliance states, and audience/journey integration depth.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Campaign index (campaign_index)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Provide list, filtering, lifecycle status, and duplication/archive actions for campaigns.
- **Observed product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Match campaign list depth: filtering, saved views, statuses, schedules, approvals, folders, duplication, archiving, and batch actions.
  - Add richer historical context, ownership/approval metadata, and multi-channel campaign visibility.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Campaign creation wizard (campaign_wizard)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Capture high-level campaign metadata before design and send.
- **Observed product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families:** `experimentation_depth`
- **Required work to reach parity:**
  - Deepen campaign creation flows for regular, automated, RSS, transactional-adjacent, and multivariate campaign types.
  - Match recipient selection, scheduling, approvals, compliance checks, send-time optimization, and review/send workflows.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Email builder (email_builder)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Assemble message content with block editing, styling, previewing, and asset use.
- **Observed product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`, `packages/app/routes/templates.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen the email builder block system, drag/drop editing, merge tags, conditional content, previews, testing, and collaboration.
  - Match content reuse, asset linking, brand kits, render fidelity, and responsive preview parity.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Template library (template_library)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Offer reusable starting points for campaigns and saved custom layouts.
- **Observed product files:** `packages/app/routes/templates.mjs`, `packages/app/domain-campaigns.mjs`
- **Targeted tests:** `tests/template-variants-routes.test.mjs`, `tests/template-approvals-routes.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Match template gallery taxonomy, previews, filtering, ownership, permissions, approvals, and brand/template inheritance.
  - Add true template lifecycle management, versioning, duplication, review, and dependency tracking.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Content studio / asset manager (content_studio)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Store and retrieve reusable images or creative assets used across campaigns.
- **Observed product files:** `packages/app/routes/content-library.mjs`, `packages/app/routes/content-ops.mjs`
- **Targeted tests:** `tests/content-library.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families:** `content_studio_depth`
- **Required work to reach parity:**
  - Implement full asset-library depth: folders, metadata, search, tagging, previews, image editing, approvals, and reuse workflows.
  - Match cross-surface content insertion, locking, collaboration, and auditability across campaigns, templates, sites, and automations.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Send / schedule / review (send_schedule_review)

- **Wave:** `wave_2_campaign_authoring_content_and_send`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Review a draft campaign, run preflight checks, send test messages, and schedule delivery.
- **Observed product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen send/review parity: audience checks, compliance warnings, subject/preheader validation, render previews, approval gates, and schedule optimization.
  - Add send-window constraints, timezone behavior, retry/cancel/edit-after-schedule flows, and audit history.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Reports overview (reports_overview)

- **Wave:** `wave_3_reporting_automation_and_growth`
- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Confidence:** `medium`
- **Purpose:** Aggregate recent campaign, automation, and audience performance metrics.
- **Observed product files:** `packages/app/routes/reports.mjs`, `packages/app/routes/api-admin.mjs`
- **Targeted tests:** `tests/reports-admin.test.mjs`, `tests/billing-analytics.test.mjs`
- **Open gap families:** `predictive_optimization_depth`
- **Required work to reach parity:**
  - Match executive reporting dashboards, trend views, comparisons, benchmarks, attribution, and audience growth synthesis.
  - Add richer export/sharing/report scheduling and role-aware reporting permissions.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Report detail (report_detail)

- **Wave:** `wave_3_reporting_automation_and_growth`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Show per-campaign or per-automation performance metrics and recipient activity.
- **Observed product files:** `packages/app/routes/reports.mjs`, `packages/app/domain-campaigns.mjs`
- **Targeted tests:** `tests/reports-admin.test.mjs`, `tests/current-product-parity.test.mjs`
- **Open gap families:** `experimentation_depth`, `predictive_optimization_depth`
- **Required work to reach parity:**
  - Implement deep single-campaign and journey detail reports: engagement, revenue attribution, cohorting, funnel analysis, and comparison views.
  - Match experiment result analysis, link-level drill-downs, device/client detail, and anomaly explanations.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Automations overview (automations_overview)

- **Wave:** `wave_3_reporting_automation_and_growth`
- **Priority:** `P1`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** List, summarize, and launch automation or journey flows.
- **Observed product files:** `packages/app/domain-journeys.mjs`, `packages/app/routes/automations.mjs`
- **Targeted tests:** `tests/automation-journeys.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Add richer automation library, health/status views, run history, template selection, analytics, and operational controls.
  - Match automation governance, ownership, approvals, and diagnostics.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Customer journey / automation builder (automation_journey_builder)

- **Wave:** `wave_3_reporting_automation_and_growth`
- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** Visually assemble triggered multi-step workflows.
- **Observed product files:** `packages/app/domain-journeys.mjs`, `packages/app/routes/automations.mjs`
- **Targeted tests:** `tests/automation-journeys.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen journey nodes, triggers, goals, branching, delays, conditions, and debugging views to production-style breadth.
  - Match reusable journeys, testing/simulation, analytics overlays, and cross-channel actions.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Landing pages (landing_pages)

- **Wave:** `wave_3_reporting_automation_and_growth`
- **Priority:** `P1`
- **Current status:** `observed_direct`
- **Confidence:** `medium`
- **Purpose:** Create standalone conversion pages connected to audiences and campaigns.
- **Observed product files:** `packages/app/routes/leads.mjs`, `packages/app/routes/websites.mjs`
- **Targeted tests:** `tests/forms-landing.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen landing-page builder parity: block library, page settings, SEO, experimentation, analytics, and publish lifecycle.
  - Match domain mapping, asset management, duplication, templates, and conversion reporting.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Website builder (website_builder)

- **Wave:** `wave_3_reporting_automation_and_growth`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Manage broader hosted web presence beyond standalone landing pages.
- **Observed product files:** `packages/app/routes/websites.mjs`, `packages/app/domain-commerce-revenue.mjs`
- **Targeted tests:** `tests/current-product-parity.test.mjs`
- **Open gap families:** `website_builder_depth`
- **Required work to reach parity:**
  - Implement a distinct website object model with navigation, theme system, pages/blog/store depth, publish workflow, and analytics.
  - Match reusable sections, domain management, SEO, commerce embedding, and site-wide asset/content management.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Integrations marketplace (integrations_marketplace)

- **Wave:** `wave_4_admin_integrations_revenue_and_governance`
- **Priority:** `P2`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Discover and manage connected apps such as Shopify, Salesforce, Zapier, and analytics tools.
- **Observed product files:** `packages/app/routes/integrations.mjs`, `packages/app/domain-custom-journeys.mjs`
- **Targeted tests:** `tests/integrations-marketplace.test.mjs`
- **Open gap families:** `integration_ecosystem_realism`
- **Required work to reach parity:**
  - Deepen real integration lifecycle: discovery, auth/install, sync controls, settings, health, error handling, and uninstall/reconnect behavior.
  - Expand catalog realism, partner metadata, and data sync depth across commerce, CRM, ads, analytics, and support systems.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### API keys and webhooks (api_keys_webhooks)

- **Wave:** `wave_4_admin_integrations_revenue_and_governance`
- **Priority:** `P2`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Expose developer-oriented access and event wiring surfaces.
- **Observed product files:** `packages/app/routes/api-admin.mjs`
- **Targeted tests:** `tests/reports-admin.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Build a full developer/admin surface for API keys, scopes, revocation, rotation, webhook endpoints, event subscriptions, and logs.
  - Add webhook delivery history, retry controls, secrets management, and app-level developer tooling/documentation links.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Billing and plans (billing_plans)

- **Wave:** `wave_4_admin_integrations_revenue_and_governance`
- **Priority:** `P2`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Handle subscriptions, payment methods, usage meters, and plan-gated upsells.
- **Observed product files:** `packages/app/routes/api-admin.mjs`, `packages/app/domain-commerce-revenue.mjs`
- **Targeted tests:** `tests/billing-analytics.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Deepen plan/entitlement parity, invoice history, usage tracking, upgrade/downgrade, trials, and billing administration flows.
  - Match billing edge cases, taxation, payment recovery, seat/usage visibility, and role-based billing permissions.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Settings, domains, and authentication (settings_domains)

- **Wave:** `wave_4_admin_integrations_revenue_and_governance`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Manage account-level defaults, sender authentication, and connected domains.
- **Observed product files:** `packages/app/routes/api-admin.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests:** `tests/security-ops-hardening.test.mjs`, `tests/platform-spine.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Expand settings parity across domains, sender reputation, authentication, DNS, branding, notifications, and regional/compliance settings.
  - Match verification flows, failure recovery, admin controls, and auditability for domain and account settings changes.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Team users, roles, and permissions (team_roles_permissions)

- **Wave:** `wave_4_admin_integrations_revenue_and_governance`
- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Confidence:** `low`
- **Purpose:** Invite collaborators and enforce scoped access across account surfaces.
- **Observed product files:** `packages/app/domain-notes.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`
- **Open gap families:** none explicitly linked
- **Required work to reach parity:**
  - Implement full team/org/workspace permission parity including invite lifecycle, custom roles, scoped permissions, approvals, and admin views.
  - Add audit trails, permission inheritance, ownership transfer, and enterprise organization controls.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

## Cross-cutting programs required for whole-product parity

- **program_deliverability_and_sending_infrastructure** (P0) — Deliverability and sending infrastructure: queues, throughput shaping, suppression pipelines, bounce/complaint processing, sender reputation, warmup, and compliance enforcement.
- **program_data_platform_and_event_ingestion** (P0) — Data platform and event ingestion: high-volume click/open/site/commerce event collection, retention, indexing, backfill, and report recomputation.
- **program_abuse_and_fraud_controls** (P0) — Abuse and fraud controls: account risk, sending review, domain trust, webhook abuse, signup abuse, content checks, and sanctions/compliance workflows.
- **program_enterprise_identity_and_governance** (P1) — Enterprise identity and governance: SSO, SCIM, org hierarchies, admin policy, audit exports, delegated administration, and region controls.
- **program_billing_entitlements_platform** (P1) — Billing/entitlements platform: plans, feature flags, trials, usage meters, invoicing, taxes, collections, and entitlement propagation.
- **program_experimentation_platform** (P1) — Experimentation platform: experiment config, traffic allocation, result stats, guardrails, stopping rules, and reporting.
- **program_predictive_ml_systems** (P1) — Predictive/ML systems: recommendations, forecast models, content scoring, send-time optimization, churn/CLV/probability models, and model ops.
- **program_omnichannel_orchestration** (P1) — Omnichannel orchestration: SMS, ads, social, surveys, push/mobile tie-ins, and cross-channel reporting/journey actions.
- **program_content_design_system_depth** (P1) — Content/design system depth: drag/drop blocks, responsive rendering fidelity, brand kits, reusable sections, versioning, and approvals.
- **program_integration_ecosystem_breadth** (P2) — Integration ecosystem breadth: partner SDK patterns, auth variants, sync monitoring, field mapping, schema evolution, and support workflows.
- **program_support_and_help_surfaces** (P2) — Support and help surfaces beyond current map: contextual help, guided setup, searchable knowledge, ticketing/escalation, and diagnostics.
- **program_mobile_specific_parity** (P2) — Mobile-specific parity: mobile workflows, push notifications, approvals, dashboard/report consumption, and edit/send/admin flows on mobile.
- **program_scale_and_multi_tenant_hardening** (P1) — Performance, scale, and multi-tenant hardening: caching, background jobs, data partitioning, migrations, failure recovery, and rate limiting.
- **program_observability_and_ops_tooling** (P1) — Observability and ops tooling: admin consoles, replay/debugging, alerting, runbooks, audit logs, and customer support tooling.
- **program_localization_accessibility_and_compliance** (P1) — Localization, accessibility, and compliance depth across all product surfaces.

## Cleanup / canonical-doc set

- **Keep:**
  - `docs/MAILCHIMP_CANONICAL_PARITY_AUDIT_2026-04-11.md`
  - `docs/MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json`
  - `docs/MAILCHIMP_CANONICAL_PARITY_EXECUTION_BACKLOG_2026-04-11.md`
  - `docs/MAILCHIMP_CANONICAL_PARITY_EXECUTION_BACKLOG_2026-04-11.json`
- **Superseded and removed from active use:**
  - `docs/MAILCHIMP_1TO1_AUDIT_2026-04-04.md`
  - `docs/MAILCHIMP_CURRENT_PRODUCT_PARITY_COMPLETION_2026-04-04.md`
  - `docs/MAILCHIMP_CURRENT_PRODUCT_PARITY_GAP_ROADMAP_2026-04-03.md`
  - `docs/MAILCHIMP_FULL_AUDIT_2026-04-04.md`
  - `docs/MAILCHIMP_FULL_AUDIT_GAP_CLOSURE_CHECKLIST_2026-04-04.md`
  - `docs/MAILCHIMP_FULL_CLONE_CAMPAIGN_LAUNCH_2026-04-04.md`
  - `docs/MAILCHIMP_FULL_CLONE_FINAL_REPORT_2026-04-02.md`
  - `docs/MAILCHIMP_FULL_CLONE_REPLAN_CLEAN_BASELINE_2026-04-04.md`
  - `docs/MAILCHIMP_PROGRAMS_1_3_FINAL_REPORT_2026-04-02.md`
  - `docs/MAILCHIMP_TRUE_1TO1_EXECUTION_BRIEF_2026-04-04.md`
  - `docs/MAILCHIMP_TRUE_1TO1_GAP_CLOSURE_PLAN_2026-04-04.md`
  - `docs/MAILCHIMP_TRUE_1TO1_SURFACE_MATRIX_2026-04-04.json`
  - `docs/mailchimp_current_product_gap_matrix_2026-04-03.json`

## Honest stop condition

- Do not call the clone 100% parity until every surface above is deep, the cross-cutting programs are materially present, and direct product evidence exists for the claimed depth.
