# Mailchimp canonical one-pass execution plan - 2026-04-11

This is the **primary canonical execution document** for Mailchimp parity work.

It is the canonical **one-pass execution plan** for taking the Mailchimp clone from the current audited state to full-clone parity.

It is derived from:
- `docs/MAILCHIMP_CANONICAL_PARITY_AUDIT_2026-04-11.md`
- `docs/MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json`
- `docs/MAILCHIMP_CANONICAL_PARITY_EXECUTION_BACKLOG_2026-04-11.json`

## Core intent

- Execution mode: `one_pass_continuous_campaign`
- Fidelity: `full_clone`
- Current honest deep-parity estimate: **8% to 15%**, confidence **low**
- The objective is **not** to finish isolated waves and stop. The objective is to run one continuous parity campaign until the supervisor is green for the whole requested scope or a real blocker report is produced.

## What one-pass means here

- Treat the entire Mailchimp clone as one continuous parity campaign, not a set of independently successful mini-projects.
- Wave boundaries are prioritization lanes only. They do not create valid stopping points unless the entire supervisor contract is green or a real blocker report is produced.
- Do not count supervisor green, campaign green, or proof-path repair as product parity unless direct product files and targeted tests substantiate the claimed surface depth.
- Do not stop after a shallow route, mock, or happy-path implementation. A surface is unfinished until its production-style workflow depth is present and evidenced.
- If a lane stalls, retarget within the same run to another unresolved dependency-safe lane instead of declaring partial completion as success.
- If the run stops red, emit a blocker report with exact missing surfaces, evidence gaps, and next focus. If the run stops green, every requested surface and cross-cutting program must satisfy the parity contract.

## Stop condition

- Campaign stop condition: `supervisor_green_or_blocker_report`
- 100% parity claim gate: `all_surfaces_at_product_depth_and_cross_cutting_programs_materially_present_with_direct_product_evidence`

## Orchestration roles

- **contract_binder**: binds the run to the canonical audit, matrix, and one-pass plan
- **surface_scheduler**: continuously picks the next unresolved high-value surface or dependency lane
- **product_implementers**: modify real product files only, not just scaffolding or planning artifacts
- **test_implementers**: create or deepen targeted tests that prove product behavior and edge cases
- **verifiers**: check changed files, run targeted validations, and reject shallow/no-op claims
- **supervisor**: maintains authoritative surface state, blocker state, and completion truth
- **notifier**: announces only supervisor-confirmed final completion or blocker state

## Continuous-run stages

### stage_0_bind_contract_and_baseline_truth

- **Objective:** Bind to the canonical parity audit, matrix, and one-pass plan. Establish truthful baseline state and unresolved-surface inventory before implementation begins.
- **Outputs:** `run contract`, `surface matrix snapshot`, `baseline evidence ledger`, `initial next-focus ordering`

### stage_1_foundation_funnel_and_audience_spine

- **Objective:** Raise the first-run funnel and core audience model to production-style depth so downstream campaign work has a credible substrate.
- **Lanes:** `wave_1_core_funnel_and_audience`

### stage_2_campaign_authoring_and_content_systems

- **Objective:** Deepen campaign creation, email authoring, templates, content studio, forms, and send/review into a durable campaign-production workflow.
- **Lanes:** `wave_2_campaign_authoring_content_and_send`

### stage_3_reporting_automation_and_growth_systems

- **Objective:** Bring reporting, automations, journeys, landing pages, and website surfaces up to product depth with real drill-down and lifecycle behavior.
- **Lanes:** `wave_3_reporting_automation_and_growth`

### stage_4_admin_integrations_revenue_and_governance

- **Objective:** Complete the non-trivial product shell around the core marketer workflows: integrations, billing, API/webhooks, settings, domains, auth, roles, and governance.
- **Lanes:** `wave_4_admin_integrations_revenue_and_governance`

### stage_5_cross_cutting_platforms_and_operational_depth

- **Objective:** Close the systemic gaps that make Mailchimp a real product rather than a demo: delivery, analytics ingestion, risk, ML, experimentation, mobile, scale, and ops.
- **Programs:** `program_deliverability_and_sending_infrastructure`, `program_data_platform_and_event_ingestion`, `program_abuse_and_fraud_controls`, `program_enterprise_identity_and_governance`, `program_billing_entitlements_platform`, `program_experimentation_platform`, `program_predictive_ml_systems`, `program_omnichannel_orchestration`, `program_content_design_system_depth`, `program_integration_ecosystem_breadth`, `program_support_and_help_surfaces`, `program_mobile_specific_parity`, `program_scale_and_multi_tenant_hardening`, `program_observability_and_ops_tooling`, `program_localization_accessibility_and_compliance`

### stage_6_qualification_evidence_and_parity_certification

- **Objective:** Re-run targeted product validation, reconcile remaining gaps, and certify only what is directly evidenced. No shallow or implied green states allowed.
- **Outputs:** `updated evidence ledger`, `surface-complete matrix`, `blocker report or parity certification`

## Internal lane bundles inside the one pass

### Core funnel, workspace bootstrap, and audience management (wave_1_core_funnel_and_audience)

- **Why it exists:** These surfaces form the first-run path from signup through audience readiness. Without them, downstream campaign/reporting parity is cosmetic.
- **Surfaces:**
  - `signup_onboarding` (Signup and onboarding wizard) — P0, current status `partial_or_shallow`, confidence `medium`
  - `account_workspace_setup` (Account workspace setup) — P0, current status `partial_or_shallow`, confidence `medium`
  - `dashboard_home` (Dashboard / home) — P1, current status `partial_or_shallow`, confidence `medium`
  - `audience_overview` (Audience overview) — P0, current status `observed_direct`, confidence `medium`
  - `contacts_table` (Contacts table) — P0, current status `observed_direct`, confidence `medium`
  - `contact_profile` (Contact profile) — P0, current status `partial_or_shallow`, confidence `low`
  - `tags_groups_interests` (Tags, groups, and interests management) — P1, current status `partial_or_shallow`, confidence `low`
  - `segments` (Segments) — P0, current status `observed_direct`, confidence `medium`
- **Lane completion criteria:**
  - New-account flow works end to end with resume/recovery behavior and richer setup branching.
  - Audience management reaches Mailchimp-like daily-operational depth, not just route presence.
  - Every surface has direct product tests for happy path, edge cases, and administrative workflows.

### Campaign authoring, content systems, forms, and send/review (wave_2_campaign_authoring_content_and_send)

- **Why it exists:** This is the revenue-critical middle of Mailchimp: authoring campaigns, designing content, collecting leads, and actually reviewing/sending.
- **Surfaces:**
  - `signup_forms_popups` (Signup forms and popup forms) — P1, current status `observed_direct`, confidence `medium`, gap families: omnichannel_depth
  - `campaign_index` (Campaign index) — P0, current status `partial_or_shallow`, confidence `medium`
  - `campaign_wizard` (Campaign creation wizard) — P0, current status `partial_or_shallow`, confidence `medium`, gap families: experimentation_depth
  - `email_builder` (Email builder) — P0, current status `partial_or_shallow`, confidence `medium`
  - `template_library` (Template library) — P1, current status `partial_or_shallow`, confidence `low`
  - `content_studio` (Content studio / asset manager) — P1, current status `partial_or_shallow`, confidence `low`, gap families: content_studio_depth
  - `send_schedule_review` (Send / schedule / review) — P0, current status `partial_or_shallow`, confidence `low`
- **Lane completion criteria:**
  - Users can create, design, preview, review, schedule, and send campaigns with production-style guardrails.
  - Templates, content assets, and forms behave as reusable systems rather than thin route demos.
  - Campaign build/test/send lifecycle is backed by direct product tests and realistic UX states.

### Reporting, automations, landing pages, and growth surfaces (wave_3_reporting_automation_and_growth)

- **Why it exists:** Mailchimp parity requires not only building campaigns, but understanding outcomes and orchestrating lifecycle growth journeys.
- **Surfaces:**
  - `reports_overview` (Reports overview) — P0, current status `partial_or_shallow`, confidence `medium`, gap families: predictive_optimization_depth
  - `report_detail` (Report detail) — P1, current status `partial_or_shallow`, confidence `low`, gap families: experimentation_depth, predictive_optimization_depth
  - `automations_overview` (Automations overview) — P1, current status `observed_direct`, confidence `medium`
  - `automation_journey_builder` (Customer journey / automation builder) — P0, current status `observed_direct`, confidence `medium`
  - `landing_pages` (Landing pages) — P1, current status `observed_direct`, confidence `medium`
  - `website_builder` (Website builder) — P1, current status `partial_or_shallow`, confidence `low`, gap families: website_builder_depth
- **Lane completion criteria:**
  - Reporting supports detailed drill-down, attribution context, and comparison workflows.
  - Automations and journeys are deep enough for real triggered lifecycle programs.
  - Landing pages and websites move from shallow presence to durable publishing systems.

### Integrations, developer/admin tooling, billing, settings, and team governance (wave_4_admin_integrations_revenue_and_governance)

- **Why it exists:** The real product includes partner ecosystem, admin controls, billing, domains, auth, and collaborative governance. These are required for whole-product parity.
- **Surfaces:**
  - `integrations_marketplace` (Integrations marketplace) — P2, current status `partial_or_shallow`, confidence `low`, gap families: integration_ecosystem_realism
  - `api_keys_webhooks` (API keys and webhooks) — P2, current status `partial_or_shallow`, confidence `low`
  - `billing_plans` (Billing and plans) — P2, current status `partial_or_shallow`, confidence `low`
  - `settings_domains` (Settings, domains, and authentication) — P1, current status `partial_or_shallow`, confidence `low`
  - `team_roles_permissions` (Team users, roles, and permissions) — P1, current status `partial_or_shallow`, confidence `low`
- **Lane completion criteria:**
  - Connected-app lifecycle, developer tooling, and billing/admin flows operate at product depth.
  - Settings, domains, auth, and team controls support realistic multi-user operation.
  - Enterprise and compliance-adjacent behaviors have direct proof rather than implied coverage.

## Scheduler policy

- **Primary order:**
  - unlock foundational dependencies first
  - prefer P0 unresolved surfaces
  - prefer surfaces that unblock multiple downstream lanes
  - prefer direct product depth over orchestration/proof-path work
  - retarget on no-progress streak instead of looping on the same stalled claim
- **Claim-integrity rules:**
  - Reject merges that only touch docs, scripts, supervisor state, or artifacts while claiming product parity work.
  - Require at least one real product-surface file change for surface advancement unless the run is explicitly validating already-landed code.
  - Require targeted tests or equivalent direct evidence before marking any surface complete.
  - Keep stale blocker artifacts from overriding fresher supervisor truth only after reconciliation proves the stale artifact is obsolete.

## Surface checklist inside the one-pass run

### Signup and onboarding wizard (signup_onboarding)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/index.mjs`, `packages/app/routes/public.mjs`, `packages/app/routes/platform.mjs`, `packages/app/view.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`, `tests/current-product-parity.test.mjs`
- **Required work:**
  - Expand onboarding beyond happy-path account creation into a multi-step production-style wizard with industry/use-case branching, suggested defaults, skipped-step recovery, import prompts, and contextual education.
  - Add password reset, email verification, abandoned signup recovery, invite-based onboarding, and workspace bootstrap parity.
  - Match validation/error states, loading states, instrumentation, and retry/resume behavior across the full onboarding funnel.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Account workspace setup (account_workspace_setup)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/index.mjs`, `packages/app/routes/platform.mjs`, `packages/app/view.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`
- **Required work:**
  - Implement richer workspace setup assistants for brand assets, sender settings, contact imports, audience defaults, and compliance acknowledgements.
  - Add organization/workspace switching, account handoff, ownership transfer, and migration/import tooling depth.
  - Match initial empty-state UX, first-use education, seeded recommendations, and role-based setup differences.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Dashboard / home (dashboard_home)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/index.mjs`, `packages/app/view.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`, `tests/parity-route-aliases.test.mjs`
- **Required work:**
  - Match the real dashboard widget system, personalization, KPI cards, task queues, and insight prioritization.
  - Add role-aware dashboard composition for owners, marketers, analysts, developers, and support/admin personas.
  - Deepen data freshness, drill-through behaviors, saved views, and onboarding-to-dashboard continuity.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Audience overview (audience_overview)

- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`
- **Required work:**
  - Deepen audience summary cards, health metrics, import/export history, suppression status, and lifecycle insights.
  - Add richer overview drill-downs and action flows tied to segments, campaigns, automations, and commerce events.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Contacts table (contacts_table)

- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`
- **Required work:**
  - Match full contacts-table parity: bulk actions, saved columns, sorting, filters, pagination, imports, exports, and merge/dedup flows.
  - Deepen profile row actions, consent/suppression states, tags/groups/interests visibility, and contact timeline integration.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Contact profile (contact_profile)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`
- **Required work:**
  - Implement a full contact profile with activity timeline, campaign history, automation participation, ecommerce history, notes, and custom fields.
  - Add editing, auditability, source attribution, suppression/consent controls, and related segment/journey visibility.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Tags, groups, and interests management (tags_groups_interests)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-core.test.mjs`, `tests/audience-funnels.test.mjs`
- **Required work:**
  - Deepen tag/group/interest creation, hierarchy management, assignment at scale, import/export support, and reporting integration.
  - Match Mailchimp-style audience organization workflows including bulk editing, automated assignment, and segment-builder integration.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Segments (segments)

- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Lane:** `wave_1_core_funnel_and_audience`
- **Product files:** `packages/app/domain-audience.mjs`, `packages/app/routes/audience.mjs`
- **Targeted tests:** `tests/audience-funnels.test.mjs`
- **Required work:**
  - Expand segment grammar to include richer boolean logic, temporal filters, predictive clauses, and reusable saved segment patterns.
  - Match live audience counts, preview samples, eligibility explanations, and segment-to-campaign/journey handoff UX.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Signup forms and popup forms (signup_forms_popups)

- **Priority:** `P1`
- **Current status:** `observed_direct`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/domain-leads.mjs`, `packages/app/routes/leads.mjs`
- **Targeted tests:** `tests/forms-landing.test.mjs`
- **Required work:**
  - Deepen embedded, popup, modal, and hosted signup forms with targeting rules, scheduling, analytics, and branding/theming parity.
  - Add publish lifecycle controls, placement management, consent/compliance states, and audience/journey integration depth.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Campaign index (campaign_index)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`
- **Required work:**
  - Match campaign list depth: filtering, saved views, statuses, schedules, approvals, folders, duplication, archiving, and batch actions.
  - Add richer historical context, ownership/approval metadata, and multi-channel campaign visibility.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Campaign creation wizard (campaign_wizard)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`, `tests/current-product-parity.test.mjs`
- **Required work:**
  - Deepen campaign creation flows for regular, automated, RSS, transactional-adjacent, and multivariate campaign types.
  - Match recipient selection, scheduling, approvals, compliance checks, send-time optimization, and review/send workflows.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Email builder (email_builder)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`, `packages/app/routes/templates.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`
- **Required work:**
  - Deepen the email builder block system, drag/drop editing, merge tags, conditional content, previews, testing, and collaboration.
  - Match content reuse, asset linking, brand kits, render fidelity, and responsive preview parity.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Template library (template_library)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/routes/templates.mjs`, `packages/app/domain-campaigns.mjs`
- **Targeted tests:** `tests/template-variants-routes.test.mjs`, `tests/template-approvals-routes.test.mjs`
- **Required work:**
  - Match template gallery taxonomy, previews, filtering, ownership, permissions, approvals, and brand/template inheritance.
  - Add true template lifecycle management, versioning, duplication, review, and dependency tracking.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Content studio / asset manager (content_studio)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/routes/content-library.mjs`, `packages/app/routes/content-ops.mjs`
- **Targeted tests:** `tests/content-library.test.mjs`, `tests/current-product-parity.test.mjs`
- **Required work:**
  - Implement full asset-library depth: folders, metadata, search, tagging, previews, image editing, approvals, and reuse workflows.
  - Match cross-surface content insertion, locking, collaboration, and auditability across campaigns, templates, sites, and automations.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Send / schedule / review (send_schedule_review)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_2_campaign_authoring_content_and_send`
- **Product files:** `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`
- **Targeted tests:** `tests/campaign-editor-depth.test.mjs`
- **Required work:**
  - Deepen send/review parity: audience checks, compliance warnings, subject/preheader validation, render previews, approval gates, and schedule optimization.
  - Add send-window constraints, timezone behavior, retry/cancel/edit-after-schedule flows, and audit history.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Reports overview (reports_overview)

- **Priority:** `P0`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_3_reporting_automation_and_growth`
- **Product files:** `packages/app/routes/reports.mjs`, `packages/app/routes/api-admin.mjs`
- **Targeted tests:** `tests/reports-admin.test.mjs`, `tests/billing-analytics.test.mjs`
- **Required work:**
  - Match executive reporting dashboards, trend views, comparisons, benchmarks, attribution, and audience growth synthesis.
  - Add richer export/sharing/report scheduling and role-aware reporting permissions.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Report detail (report_detail)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_3_reporting_automation_and_growth`
- **Product files:** `packages/app/routes/reports.mjs`, `packages/app/domain-campaigns.mjs`
- **Targeted tests:** `tests/reports-admin.test.mjs`, `tests/current-product-parity.test.mjs`
- **Required work:**
  - Implement deep single-campaign and journey detail reports: engagement, revenue attribution, cohorting, funnel analysis, and comparison views.
  - Match experiment result analysis, link-level drill-downs, device/client detail, and anomaly explanations.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Automations overview (automations_overview)

- **Priority:** `P1`
- **Current status:** `observed_direct`
- **Lane:** `wave_3_reporting_automation_and_growth`
- **Product files:** `packages/app/domain-journeys.mjs`, `packages/app/routes/automations.mjs`
- **Targeted tests:** `tests/automation-journeys.test.mjs`
- **Required work:**
  - Add richer automation library, health/status views, run history, template selection, analytics, and operational controls.
  - Match automation governance, ownership, approvals, and diagnostics.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Customer journey / automation builder (automation_journey_builder)

- **Priority:** `P0`
- **Current status:** `observed_direct`
- **Lane:** `wave_3_reporting_automation_and_growth`
- **Product files:** `packages/app/domain-journeys.mjs`, `packages/app/routes/automations.mjs`
- **Targeted tests:** `tests/automation-journeys.test.mjs`
- **Required work:**
  - Deepen journey nodes, triggers, goals, branching, delays, conditions, and debugging views to production-style breadth.
  - Match reusable journeys, testing/simulation, analytics overlays, and cross-channel actions.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Landing pages (landing_pages)

- **Priority:** `P1`
- **Current status:** `observed_direct`
- **Lane:** `wave_3_reporting_automation_and_growth`
- **Product files:** `packages/app/routes/leads.mjs`, `packages/app/routes/websites.mjs`
- **Targeted tests:** `tests/forms-landing.test.mjs`
- **Required work:**
  - Deepen landing-page builder parity: block library, page settings, SEO, experimentation, analytics, and publish lifecycle.
  - Match domain mapping, asset management, duplication, templates, and conversion reporting.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Website builder (website_builder)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_3_reporting_automation_and_growth`
- **Product files:** `packages/app/routes/websites.mjs`, `packages/app/domain-commerce-revenue.mjs`
- **Targeted tests:** `tests/current-product-parity.test.mjs`
- **Required work:**
  - Implement a distinct website object model with navigation, theme system, pages/blog/store depth, publish workflow, and analytics.
  - Match reusable sections, domain management, SEO, commerce embedding, and site-wide asset/content management.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Integrations marketplace (integrations_marketplace)

- **Priority:** `P2`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_4_admin_integrations_revenue_and_governance`
- **Product files:** `packages/app/routes/integrations.mjs`, `packages/app/domain-custom-journeys.mjs`
- **Targeted tests:** `tests/integrations-marketplace.test.mjs`
- **Required work:**
  - Deepen real integration lifecycle: discovery, auth/install, sync controls, settings, health, error handling, and uninstall/reconnect behavior.
  - Expand catalog realism, partner metadata, and data sync depth across commerce, CRM, ads, analytics, and support systems.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### API keys and webhooks (api_keys_webhooks)

- **Priority:** `P2`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_4_admin_integrations_revenue_and_governance`
- **Product files:** `packages/app/routes/api-admin.mjs`
- **Targeted tests:** `tests/reports-admin.test.mjs`
- **Required work:**
  - Build a full developer/admin surface for API keys, scopes, revocation, rotation, webhook endpoints, event subscriptions, and logs.
  - Add webhook delivery history, retry controls, secrets management, and app-level developer tooling/documentation links.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Billing and plans (billing_plans)

- **Priority:** `P2`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_4_admin_integrations_revenue_and_governance`
- **Product files:** `packages/app/routes/api-admin.mjs`, `packages/app/domain-commerce-revenue.mjs`
- **Targeted tests:** `tests/billing-analytics.test.mjs`
- **Required work:**
  - Deepen plan/entitlement parity, invoice history, usage tracking, upgrade/downgrade, trials, and billing administration flows.
  - Match billing edge cases, taxation, payment recovery, seat/usage visibility, and role-based billing permissions.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Settings, domains, and authentication (settings_domains)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_4_admin_integrations_revenue_and_governance`
- **Product files:** `packages/app/routes/api-admin.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests:** `tests/security-ops-hardening.test.mjs`, `tests/platform-spine.test.mjs`
- **Required work:**
  - Expand settings parity across domains, sender reputation, authentication, DNS, branding, notifications, and regional/compliance settings.
  - Match verification flows, failure recovery, admin controls, and auditability for domain and account settings changes.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

### Team users, roles, and permissions (team_roles_permissions)

- **Priority:** `P1`
- **Current status:** `partial_or_shallow`
- **Lane:** `wave_4_admin_integrations_revenue_and_governance`
- **Product files:** `packages/app/domain-notes.mjs`, `packages/app/routes/platform.mjs`
- **Targeted tests:** `tests/platform-spine.test.mjs`
- **Required work:**
  - Implement full team/org/workspace permission parity including invite lifecycle, custom roles, scoped permissions, approvals, and admin views.
  - Add audit trails, permission inheritance, ownership transfer, and enterprise organization controls.
- **Definition of done:**
  - Surface behavior reaches production-style depth for the named Mailchimp workflow, not just route or stub presence.
  - Direct product evidence exists in product files and targeted tests for core flows, edge cases, and admin/operational states.
  - The surface no longer depends on carried-forward proof or supervisor green status to imply depth.

## Cross-cutting programs that must run in parallel with product-surface closure

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

## Final parity gate

- **Required:**
  - all 26 named surfaces satisfy definition of done
  - cross-cutting programs are materially present where required for whole-product parity
  - direct product evidence exists for all completion claims
  - no remaining blocker report
  - supervisor and canonical summary agree on green/all_complete/full
- **False greens to reject:**
  - fast green runs with zero meaningful product patches
  - green caused by proof reconciliation without matching product depth
  - surface completion inferred from route presence alone
  - completion claims backed only by orchestration artifacts or notifier state

## Bottom line

- This plan treats Mailchimp parity as **one continuous orchestrated campaign**.
- The waves are still useful, but only as internal lane structure inside the pass.
- The campaign is not done when one lane looks good. It is done only when the whole-product parity gate is satisfied.
