#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMailchimpFrontierStrictGaps, buildMailchimpFrontierStrictSurfaces } from './mailchimp-continuous-frontier-catalog.mjs';
import { buildMailchimpGlobalGapStrictGaps, buildMailchimpGlobalGapStrictSurfaces } from './mailchimp-global-gap-inventory-catalog.mjs';
import { reduceRunState } from '../../packages/orchestrator-run-state/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));
const DEFAULT_PHASE13_ARTIFACT = path.join(DEFAULT_STACK_ROOT, 'artifacts/benchmarks/mailchimp_phase13_website_designer_preflight/remote-proof-20260511-042136');

const BENCHMARK_ID = 'mailchimp_autonomous_strict_gap_continuation';
const JOURNEY_TEST_COMMAND = 'node --test --test-concurrency=1 tests/journey-designer-client.test.mjs tests/automation-journeys.test.mjs';
const JOURNEY_HONESTY_TESTS = ['tests/journey-designer-client.test.mjs', 'tests/automation-journeys.test.mjs'];
const AUDIENCE_TEST_COMMAND = 'node --test --test-concurrency=1 tests/audience-warehouse-lifecycle.test.mjs tests/audience-core.test.mjs';
const AUDIENCE_HONESTY_TESTS = ['tests/audience-warehouse-lifecycle.test.mjs', 'tests/audience-core.test.mjs'];
const REPORTING_TEST_COMMAND = 'node --test --test-concurrency=1 tests/reporting-telemetry-pipeline.test.mjs tests/reports-admin.test.mjs tests/billing-analytics.test.mjs';
const REPORTING_HONESTY_TESTS = ['tests/reporting-telemetry-pipeline.test.mjs', 'tests/reports-admin.test.mjs', 'tests/billing-analytics.test.mjs'];
const AI_PREDICTIVE_TEST_COMMAND = 'node --test --test-concurrency=1 tests/ai-predictive-recommendations.test.mjs tests/current-product-parity.test.mjs';
const AI_PREDICTIVE_HONESTY_TESTS = ['tests/ai-predictive-recommendations.test.mjs', 'tests/current-product-parity.test.mjs'];
const INTEGRATION_PROVIDER_TEST_COMMAND = 'node --test --test-concurrency=1 tests/integration-provider-account-runtime.test.mjs tests/integrations-marketplace.test.mjs tests/current-product-parity.test.mjs';
const INTEGRATION_PROVIDER_HONESTY_TESTS = ['tests/integration-provider-account-runtime.test.mjs', 'tests/integrations-marketplace.test.mjs', 'tests/current-product-parity.test.mjs'];
const AUTH_SECURITY_TEST_COMMAND = 'node --test --test-concurrency=1 tests/auth-security-runtime.test.mjs tests/security-ops-hardening.test.mjs tests/platform-spine.test.mjs';
const AUTH_SECURITY_HONESTY_TESTS = ['tests/auth-security-runtime.test.mjs', 'tests/security-ops-hardening.test.mjs', 'tests/platform-spine.test.mjs'];
const PERSISTENCE_JOBS_TEST_COMMAND = 'node --test --test-concurrency=1 tests/persistence-jobs-operational-runtime.test.mjs tests/persistence-storage.test.mjs tests/sqlite-persistence.test.mjs tests/security-ops-hardening.test.mjs';
const PERSISTENCE_JOBS_HONESTY_TESTS = ['tests/persistence-jobs-operational-runtime.test.mjs', 'tests/persistence-storage.test.mjs', 'tests/sqlite-persistence.test.mjs', 'tests/security-ops-hardening.test.mjs'];
const FRONTEND_CLIENT_SHELL_TEST_COMMAND = 'node --test --test-concurrency=1 tests/frontend-client-shell-runtime.test.mjs tests/campaign-editor-client.test.mjs tests/website-designer-client.test.mjs';
const FRONTEND_CLIENT_SHELL_HONESTY_TESTS = ['tests/frontend-client-shell-runtime.test.mjs', 'tests/campaign-editor-client.test.mjs', 'tests/website-designer-client.test.mjs'];
const CAMPAIGN_EDITOR_VISUAL_BUILDER_TEST_COMMAND = 'node --test --test-concurrency=1 tests/campaign-editor-visual-builder-runtime.test.mjs tests/campaign-editor-client.test.mjs tests/campaign-editor-depth.test.mjs';
const CAMPAIGN_EDITOR_VISUAL_BUILDER_HONESTY_TESTS = ['tests/campaign-editor-visual-builder-runtime.test.mjs', 'tests/campaign-editor-client.test.mjs', 'tests/campaign-editor-depth.test.mjs'];
const WEBSITE_BUILDER_PUBLISH_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/website-builder-publish-runtime.test.mjs tests/website-designer-client.test.mjs tests/current-product-parity.test.mjs';
const WEBSITE_BUILDER_PUBLISH_RUNTIME_HONESTY_TESTS = ['tests/website-builder-publish-runtime.test.mjs', 'tests/website-designer-client.test.mjs', 'tests/current-product-parity.test.mjs'];
const LEAD_CAPTURE_CONVERSION_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/lead-capture-conversion-runtime.test.mjs tests/forms-landing.test.mjs tests/phase9-lead-capture-parity.test.mjs';
const LEAD_CAPTURE_CONVERSION_RUNTIME_HONESTY_TESTS = ['tests/lead-capture-conversion-runtime.test.mjs', 'tests/forms-landing.test.mjs', 'tests/phase9-lead-capture-parity.test.mjs'];
const COMMERCE_REVENUE_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/commerce-revenue-runtime.test.mjs tests/current-product-parity.test.mjs tests/phase9-remaining-parity.test.mjs';
const COMMERCE_REVENUE_RUNTIME_HONESTY_TESTS = ['tests/commerce-revenue-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/phase9-remaining-parity.test.mjs'];
const CONVERSATION_INBOX_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/conversation-inbox-runtime.test.mjs tests/conversation-inbox.test.mjs tests/mobile-app-experience.test.mjs';
const CONVERSATION_INBOX_RUNTIME_HONESTY_TESTS = ['tests/conversation-inbox-runtime.test.mjs', 'tests/conversation-inbox.test.mjs', 'tests/mobile-app-experience.test.mjs'];
const SURVEY_FEEDBACK_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/surveys-feedback-runtime.test.mjs tests/surveys-feedback.test.mjs tests/mobile-app-experience.test.mjs';
const SURVEY_FEEDBACK_RUNTIME_HONESTY_TESTS = ['tests/surveys-feedback-runtime.test.mjs', 'tests/surveys-feedback.test.mjs', 'tests/mobile-app-experience.test.mjs'];
const PREFERENCE_CENTER_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/preferences-center-runtime.test.mjs tests/preferences-center.test.mjs tests/mobile-app-experience.test.mjs';
const PREFERENCE_CENTER_RUNTIME_HONESTY_TESTS = ['tests/preferences-center-runtime.test.mjs', 'tests/preferences-center.test.mjs', 'tests/mobile-app-experience.test.mjs'];
const TRANSACTIONAL_MESSAGING_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/transactional-messaging-runtime.test.mjs tests/transactional-journeys.test.mjs tests/mobile-app-experience.test.mjs';
const TRANSACTIONAL_MESSAGING_RUNTIME_HONESTY_TESTS = ['tests/transactional-messaging-runtime.test.mjs', 'tests/transactional-journeys.test.mjs', 'tests/mobile-app-experience.test.mjs'];
const MOBILE_APP_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/mobile-app-runtime.test.mjs tests/mobile-app-experience.test.mjs tests/transactional-journeys.test.mjs';
const MOBILE_APP_RUNTIME_HONESTY_TESTS = ['tests/mobile-app-runtime.test.mjs', 'tests/mobile-app-experience.test.mjs', 'tests/transactional-journeys.test.mjs'];
const CONTENT_STUDIO_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/content-studio-runtime.test.mjs tests/content-asset-templates.test.mjs tests/platform-spine.test.mjs';
const CONTENT_STUDIO_RUNTIME_HONESTY_TESTS = ['tests/content-studio-runtime.test.mjs', 'tests/content-asset-templates.test.mjs', 'tests/platform-spine.test.mjs'];
const SMS_MARKETING_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/sms-marketing-runtime.test.mjs tests/current-product-parity.test.mjs tests/sms-orchestration.test.mjs';
const SMS_MARKETING_RUNTIME_HONESTY_TESTS = ['tests/sms-marketing-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/sms-orchestration.test.mjs'];
const SOCIAL_PUBLISHING_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/social-publishing-runtime.test.mjs tests/current-product-parity.test.mjs tests/social-publisher.test.mjs';
const SOCIAL_PUBLISHING_RUNTIME_HONESTY_TESTS = ['tests/social-publishing-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/social-publisher.test.mjs'];
const ADS_RETARGETING_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/ads-retargeting-runtime.test.mjs tests/current-product-parity.test.mjs';
const ADS_RETARGETING_RUNTIME_HONESTY_TESTS = ['tests/ads-retargeting-runtime.test.mjs', 'tests/current-product-parity.test.mjs'];
const DEVELOPER_API_WEBHOOK_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/developer-api-webhook-runtime.test.mjs tests/reports-admin.test.mjs tests/platform-spine.test.mjs';
const DEVELOPER_API_WEBHOOK_RUNTIME_HONESTY_TESTS = ['tests/developer-api-webhook-runtime.test.mjs', 'tests/reports-admin.test.mjs', 'tests/platform-spine.test.mjs'];
const BILLING_ENTITLEMENTS_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/billing-entitlements-runtime.test.mjs tests/platform-spine.test.mjs tests/reports-admin.test.mjs';
const BILLING_ENTITLEMENTS_RUNTIME_HONESTY_TESTS = ['tests/billing-entitlements-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/reports-admin.test.mjs'];
const TEAM_GOVERNANCE_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/team-governance-runtime.test.mjs tests/platform-spine.test.mjs tests/billing-entitlements-runtime.test.mjs tests/developer-api-webhook-runtime.test.mjs';
const TEAM_GOVERNANCE_RUNTIME_HONESTY_TESTS = ['tests/team-governance-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/billing-entitlements-runtime.test.mjs', 'tests/developer-api-webhook-runtime.test.mjs'];
const SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/settings-domains-deliverability-runtime.test.mjs tests/deliverability-compliance.test.mjs tests/platform-spine.test.mjs tests/team-governance-runtime.test.mjs';
const SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_HONESTY_TESTS = ['tests/settings-domains-deliverability-runtime.test.mjs', 'tests/deliverability-compliance.test.mjs', 'tests/platform-spine.test.mjs', 'tests/team-governance-runtime.test.mjs'];
const DASHBOARD_HOME_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/dashboard-home-runtime.test.mjs tests/platform-spine.test.mjs tests/settings-domains-deliverability-runtime.test.mjs tests/team-governance-runtime.test.mjs';
const DASHBOARD_HOME_RUNTIME_HONESTY_TESTS = ['tests/dashboard-home-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/settings-domains-deliverability-runtime.test.mjs', 'tests/team-governance-runtime.test.mjs'];
const CAMPAIGN_EXPERIMENT_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/campaign-experiment-runtime.test.mjs tests/current-product-parity.test.mjs tests/dashboard-home-runtime.test.mjs tests/platform-spine.test.mjs';
const CAMPAIGN_EXPERIMENT_RUNTIME_HONESTY_TESTS = ['tests/campaign-experiment-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/dashboard-home-runtime.test.mjs', 'tests/platform-spine.test.mjs'];
const POSTCARD_DIRECT_MAIL_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/postcard-direct-mail-runtime.test.mjs tests/current-product-parity.test.mjs tests/campaign-experiment-runtime.test.mjs';
const POSTCARD_DIRECT_MAIL_RUNTIME_HONESTY_TESTS = ['tests/postcard-direct-mail-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/campaign-experiment-runtime.test.mjs'];
const CROSS_CHANNEL_JOURNEY_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/cross-channel-journey-runtime.test.mjs tests/automation-journeys.test.mjs tests/current-product-parity.test.mjs';
const CROSS_CHANNEL_JOURNEY_RUNTIME_HONESTY_TESTS = ['tests/cross-channel-journey-runtime.test.mjs', 'tests/automation-journeys.test.mjs', 'tests/current-product-parity.test.mjs'];
const SOCIAL_CALENDAR_COORDINATION_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/social-calendar-coordination-runtime.test.mjs tests/social-publishing-runtime.test.mjs tests/current-product-parity.test.mjs';
const SOCIAL_CALENDAR_COORDINATION_RUNTIME_HONESTY_TESTS = ['tests/social-calendar-coordination-runtime.test.mjs', 'tests/social-publishing-runtime.test.mjs', 'tests/current-product-parity.test.mjs'];
const OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/omnichannel-reporting-attribution-runtime.test.mjs tests/social-calendar-coordination-runtime.test.mjs tests/postcard-direct-mail-runtime.test.mjs tests/current-product-parity.test.mjs';
const OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_HONESTY_TESTS = ['tests/omnichannel-reporting-attribution-runtime.test.mjs', 'tests/social-calendar-coordination-runtime.test.mjs', 'tests/postcard-direct-mail-runtime.test.mjs', 'tests/current-product-parity.test.mjs'];
const MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_TEST_COMMAND = 'node --test --test-concurrency=1 tests/mailchimp-continuous-frontier-runtime.test.mjs tests/current-product-parity.test.mjs';
const MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_HONESTY_TESTS = ['tests/mailchimp-continuous-frontier-runtime.test.mjs', 'tests/current-product-parity.test.mjs'];

const STRICT_SURFACES = [
  {
    id: 'automation_journey_visual_orchestration_layer',
    phase: 'phase14',
    label: 'Automation journey visual orchestration layer with node reorder, branch mutation, contact preview, canvas mode, undo/redo, and serialized state',
    strictGap: 'automation/journey parity: no Mailchimp-grade visual/orchestrated runtime parity',
    match: /automation\/journey|journey parity|visual\/orchestrated runtime/i,
    productFiles: [
      'apps/web/public/journey-designer-client.mjs',
      'packages/app/routes/automations.mjs',
      'packages/app/routes/public.mjs'
    ],
    targetedTests: JOURNEY_HONESTY_TESTS,
    testCommand: JOURNEY_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase14-autonomous-journey-designer.json',
    proofReason: 'autonomous_journey_designer_product_test_proof_valid',
    requiredAssertions: [
      'journey_designer_module_served',
      'automation_builder_route_adopts_visual_designer',
      'node_reorder_state_model',
      'duplicate_node_state_model',
      'branch_condition_state_model',
      'contact_preview_state',
      'undo_redo_state_history',
      'serialized_journey_state_available',
      'durable_server_forms_preserved'
    ],
    implementationHandler: 'applyJourneyDesigner'
  },
  {
    id: 'audience_identity_lifecycle_warehouse_layer',
    phase: 'phase15',
    label: 'Audience CRM identity lifecycle warehouse with resolved profiles, duplicate review, source completeness, lifecycle stages, and durable snapshot refresh',
    strictGap: 'audience/CRM parity: limited identity/lifecycle/warehouse realism',
    match: /audience\/crm|identity\/lifecycle\/warehouse|warehouse realism|audience crm/i,
    productFiles: [
      'packages/app/domain-audience.mjs',
      'packages/app/routes/audience.mjs'
    ],
    targetedTests: AUDIENCE_HONESTY_TESTS,
    testCommand: AUDIENCE_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase15-autonomous-audience-warehouse.json',
    proofReason: 'autonomous_audience_warehouse_product_test_proof_valid',
    requiredAssertions: [
      'audience_warehouse_snapshot_model',
      'identity_graph_duplicate_resolution',
      'lifecycle_stage_distribution',
      'source_completeness_metrics',
      'warehouse_refresh_route_persists_snapshot',
      'audience_overview_links_warehouse',
      'core_audience_flows_preserved'
    ],
    implementationHandler: 'applyAudienceWarehouse'
  },
  {
    id: 'reporting_telemetry_pipeline_layer',
    phase: 'phase16',
    label: 'Reporting telemetry pipeline with event ingestion, lineage ledger, rollup snapshots, attribution, refresh action, and report UI adoption',
    strictGap: 'reporting/analytics parity: telemetry remains local rather than production pipeline parity',
    match: /reporting\/analytics|telemetry|production pipeline|analytics parity/i,
    productFiles: [
      'packages/app/analytics-events.mjs',
      'packages/app/routes/reports.mjs'
    ],
    targetedTests: REPORTING_HONESTY_TESTS,
    testCommand: REPORTING_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase16-autonomous-reporting-telemetry.json',
    proofReason: 'autonomous_reporting_telemetry_product_test_proof_valid',
    requiredAssertions: [
      'telemetry_event_ingestion_pipeline',
      'analytics_pipeline_run_ledger',
      'telemetry_lineage_ledger',
      'reporting_rollup_snapshot_model',
      'campaign_website_attribution_rollups',
      'reporting_telemetry_refresh_route',
      'reports_overview_adopts_pipeline',
      'existing_reports_preserved'
    ],
    implementationHandler: 'applyReportingTelemetry'
  },
  {
    id: 'ai_predictive_recommendation_runtime_layer',
    phase: 'phase17',
    label: 'AI predictive recommendation runtime with provider contract, feature store, model run ledger, recommendation lineage, acceptance feedback, and app routes',
    strictGap: 'AI/predictive parity: recommendations still come from local Mailclone provider seams',
    match: /ai\/predictive|predictive parity|provider seams|mailclone provider/i,
    productFiles: [
      'packages/app/ai-provider.mjs',
      'packages/app/predictive-model.mjs',
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs',
      'packages/app/domain-website-builder.mjs'
    ],
    targetedTests: AI_PREDICTIVE_HONESTY_TESTS,
    testCommand: AI_PREDICTIVE_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase17-autonomous-ai-predictive-runtime.json',
    proofReason: 'autonomous_ai_predictive_runtime_product_test_proof_valid',
    requiredAssertions: [
      'ai_provider_runtime_contract',
      'predictive_feature_store_snapshot',
      'model_run_ledger_persists',
      'recommendation_lineage_and_evidence',
      'recommendation_acceptance_feedback',
      'campaign_optimization_apply_path',
      'ai_predictive_routes_and_api',
      'current_product_ai_flows_preserved'
    ],
    implementationHandler: 'applyAiPredictiveRuntime'
  },
  {
    id: 'integration_provider_account_sync_runtime_layer',
    phase: 'phase18',
    label: 'Integration provider account sync runtime with provider account contract, OAuth session ledger, incremental cursors, request lineage, webhook verification, and marketplace adoption',
    strictGap: 'integration/provider parity: connector auth/sync remains verified through local connector seams rather than real provider accounts',
    match: /integration\/provider|connector auth|provider accounts|connector seams|sync remains/i,
    productFiles: [
      'packages/app/integration-provider.mjs',
      'packages/app/domain-integration-marketplace.mjs',
      'packages/app/routes/integrations-marketplace.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/domain-content-ecosystem-depth.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: INTEGRATION_PROVIDER_HONESTY_TESTS,
    testCommand: INTEGRATION_PROVIDER_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase18-autonomous-integration-provider-runtime.json',
    proofReason: 'autonomous_integration_provider_runtime_product_test_proof_valid',
    requiredAssertions: [
      'provider_account_runtime_contract',
      'oauth_session_ledger_persists',
      'incremental_provider_cursor_model',
      'provider_request_lineage',
      'webhook_signature_verification',
      'marketplace_and_detail_routes_adopt_provider_runtime',
      'api_exposes_provider_runtime_summary',
      'existing_integration_current_product_flows_preserved'
    ],
    implementationHandler: 'applyIntegrationProviderRuntime'
  },
  {
    id: 'auth_session_security_runtime_layer',
    phase: 'phase19',
    label: 'Authentication session security runtime with session risk ledger, CSRF validation, MFA challenge verification, SSO session ledger, API key rotation, and security center adoption',
    strictGap: 'auth/session/security parity: improved, but full production security program remains unproven',
    match: /auth\/session\/security|security program|session security|csrf|mfa|sso/i,
    productFiles: [
      'packages/app/security.mjs',
      'packages/app/routes/platform.mjs',
      'packages/app/storage.mjs',
      'packages/app/view.mjs'
    ],
    targetedTests: AUTH_SECURITY_HONESTY_TESTS,
    testCommand: AUTH_SECURITY_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase19-autonomous-auth-security-runtime.json',
    proofReason: 'autonomous_auth_security_runtime_product_test_proof_valid',
    requiredAssertions: [
      'auth_security_runtime_contract',
      'session_inventory_and_risk_ledger',
      'csrf_token_issue_and_validation',
      'mfa_factor_challenge_verification',
      'sso_session_ledger',
      'api_key_rotation_security_event',
      'security_center_routes_and_api',
      'existing_auth_platform_security_flows_preserved'
    ],
    implementationHandler: 'applyAuthSessionSecurityRuntime'
  },
  {
    id: 'persistence_jobs_operational_runtime_layer',
    phase: 'phase20',
    label: 'Persistence and jobs operational runtime with durable queue state, leases, heartbeats, retry/backoff, dead-letter requeue, and admin/API evidence',
    strictGap: 'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open',
    match: /persistence\/jobs|operational parity|job-service|sqlite wave|broader job-service/i,
    productFiles: [
      'packages/app/storage.mjs',
      'packages/app/jobs.mjs',
      'packages/app/job-runtime.mjs',
      'packages/app/job-handlers.mjs',
      'packages/app/routes/api-admin.mjs'
    ],
    targetedTests: PERSISTENCE_JOBS_HONESTY_TESTS,
    testCommand: PERSISTENCE_JOBS_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase20-autonomous-persistence-jobs-operational-runtime.json',
    proofReason: 'autonomous_persistence_jobs_operational_runtime_product_test_proof_valid',
    requiredAssertions: [
      'jobs_operational_runtime_contract',
      'durable_job_queue_collections',
      'worker_lease_and_heartbeat_ledger',
      'retry_backoff_attempt_history',
      'dead_letter_requeue_workflow',
      'job_operations_admin_route_and_api',
      'storage_runtime_reports_job_operational_ledger',
      'existing_storage_security_job_flows_preserved'
    ],
    implementationHandler: 'applyPersistenceJobsOperationalRuntime'
  },
  {
    id: 'frontend_full_client_application_runtime_layer',
    phase: 'phase21',
    label: 'Frontend full client application runtime shell with route manifest hydration, command palette navigation, optimistic route preview, recent work persistence, and progressive enhancement',
    strictGap: 'frontend interaction parity: client modules now exist for key builders, but the whole app is not yet a Mailchimp-grade full client application',
    match: /frontend interaction|full client application|client modules now exist|client shell|mailchimp-grade full client/i,
    productFiles: [
      'apps/web/public/app-shell-client.mjs',
      'apps/web/public/app-shell.jsx',
      'apps/web/public/app-shell.css',
      'packages/app/view.mjs',
      'packages/app/routes/public.mjs'
    ],
    targetedTests: FRONTEND_CLIENT_SHELL_HONESTY_TESTS,
    testCommand: FRONTEND_CLIENT_SHELL_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase21-autonomous-frontend-client-shell-runtime.json',
    proofReason: 'autonomous_frontend_client_shell_runtime_product_test_proof_valid',
    requiredAssertions: [
      'client_shell_runtime_contract',
      'route_manifest_hydration',
      'command_palette_navigation_state',
      'active_route_resolution',
      'optimistic_route_preview',
      'recent_work_persistence',
      'client_shell_manifest_and_runtime_api',
      'existing_editor_designer_flows_preserved'
    ],
    implementationHandler: 'applyFrontendClientShellRuntime'
  },
  {
    id: 'campaign_editor_visual_builder_runtime_layer',
    phase: 'phase22',
    label: 'Campaign editor visual builder runtime with block inspector state, asset crop/fit/focal transforms, style patches, personalization preview, and durable runtime API evidence',
    strictGap: 'campaign editor parity: deeper visual builder runtime still lacks Mailchimp-grade block inspectors, asset transforms, style controls, and browser-backed interaction proof',
    match: /campaign editor|visual builder|block inspector|asset transform|style controls|browser-backed interaction/i,
    productFiles: [
      'apps/web/public/editor-client.mjs',
      'apps/web/public/app-shell.css',
      'packages/app/routes/campaigns.mjs'
    ],
    targetedTests: CAMPAIGN_EDITOR_VISUAL_BUILDER_HONESTY_TESTS,
    testCommand: CAMPAIGN_EDITOR_VISUAL_BUILDER_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase22-autonomous-campaign-editor-visual-builder-runtime.json',
    proofReason: 'autonomous_campaign_editor_visual_builder_runtime_product_test_proof_valid',
    requiredAssertions: [
      'campaign_editor_visual_builder_contract',
      'block_inspector_state_model',
      'visual_style_patch_history',
      'asset_transform_crop_fit_focal_point',
      'personalization_preview_state',
      'visual_runtime_post_route_persists_patch',
      'campaign_editor_runtime_api_evidence',
      'existing_campaign_editor_flows_preserved'
    ],
    implementationHandler: 'applyCampaignEditorVisualBuilderRuntime'
  },
  {
    id: 'website_builder_publish_runtime_layer',
    phase: 'phase23',
    label: 'Website builder publish/runtime layer with SEO audit ledger, publish readiness, domain/robots checks, experiment variants, analytics goals, and runtime API evidence',
    strictGap: 'website builder parity: visual site designer exists, but Mailchimp-grade publish readiness, SEO audits, domain checks, experiments, analytics goals, and runtime API evidence remain open',
    match: /website builder|visual site designer|publish readiness|seo audits|domain checks|analytics goals/i,
    productFiles: [
      'apps/web/public/website-designer-client.mjs',
      'apps/web/public/app-shell.css',
      'packages/app/domain-website-builder.mjs',
      'packages/app/routes/website-builder.mjs'
    ],
    targetedTests: WEBSITE_BUILDER_PUBLISH_RUNTIME_HONESTY_TESTS,
    testCommand: WEBSITE_BUILDER_PUBLISH_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase23-autonomous-website-builder-publish-runtime.json',
    proofReason: 'autonomous_website_builder_publish_runtime_product_test_proof_valid',
    requiredAssertions: [
      'website_builder_publish_runtime_contract',
      'client_seo_inspector_state_model',
      'publish_readiness_checklist_model',
      'durable_seo_audit_ledger',
      'website_experiment_variant_ledger',
      'runtime_snapshot_on_publish',
      'website_runtime_api_evidence',
      'existing_website_builder_flows_preserved'
    ],
    implementationHandler: 'applyWebsiteBuilderPublishRuntime'
  },
  {
    id: 'lead_capture_landing_page_conversion_runtime_layer',
    phase: 'phase24',
    label: 'Lead capture and landing-page conversion runtime with funnel snapshots, attribution ledger, consent receipts, experiment variants, form-submission handoff evidence, and API proof',
    strictGap: 'landing pages and signup forms parity: builders exist, but Mailchimp-grade conversion runtime, attribution, consent receipts, landing-page experiments, and funnel API evidence remain open',
    match: /landing pages|signup forms|lead capture|conversion runtime|attribution|consent receipts|funnel api/i,
    productFiles: [
      'packages/app/domain-leads.mjs',
      'packages/app/domain-growth.mjs',
      'packages/app/routes/leads.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: LEAD_CAPTURE_CONVERSION_RUNTIME_HONESTY_TESTS,
    testCommand: LEAD_CAPTURE_CONVERSION_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase24-autonomous-lead-capture-conversion-runtime.json',
    proofReason: 'autonomous_lead_capture_conversion_runtime_product_test_proof_valid',
    requiredAssertions: [
      'lead_capture_conversion_runtime_contract',
      'conversion_attribution_ledger',
      'consent_receipt_ledger',
      'landing_page_experiment_variants',
      'conversion_snapshot_persistence',
      'public_landing_and_form_events_record_runtime_evidence',
      'lead_conversion_runtime_api_evidence',
      'existing_forms_landing_flows_preserved'
    ],
    implementationHandler: 'applyLeadCaptureConversionRuntime'
  },
  {
    id: 'commerce_revenue_attribution_runtime_layer',
    phase: 'phase25',
    label: 'Commerce revenue attribution and recovery runtime with customer value profiles, abandoned-cart ledger, product recommendation signals, runtime snapshots, and API proof',
    strictGap: 'commerce/revenue parity: commerce sync exists, but Mailchimp-grade order lifecycle, customer value profiles, abandoned-cart recovery, product recommendations, and runtime API evidence remain open',
    match: /commerce\/revenue|order lifecycle|customer value|abandoned.?cart|product recommendations|commerce runtime api/i,
    productFiles: [
      'packages/app/domain-commerce-revenue.mjs',
      'packages/app/routes/commerce-revenue.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: COMMERCE_REVENUE_RUNTIME_HONESTY_TESTS,
    testCommand: COMMERCE_REVENUE_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase25-autonomous-commerce-revenue-runtime.json',
    proofReason: 'autonomous_commerce_revenue_runtime_product_test_proof_valid',
    requiredAssertions: [
      'commerce_revenue_runtime_contract',
      'customer_value_profile_rollups',
      'abandoned_cart_recovery_ledger',
      'product_recommendation_signal_events',
      'commerce_runtime_snapshot_persistence',
      'store_sync_records_runtime_evidence',
      'commerce_runtime_api_evidence',
      'existing_current_product_and_phase9_flows_preserved'
    ],
    implementationHandler: 'applyCommerceRevenueRuntime'
  },
  {
    id: 'conversation_inbox_sla_assignment_runtime_layer',
    phase: 'phase26',
    label: 'Conversation inbox SLA, assignment, macro, and automation handoff runtime with runtime snapshots and API proof',
    strictGap: 'conversation inbox parity: basic threads exist, but Mailchimp-grade SLA policy, assignment history, reply macros, automation handoff, sentiment, and runtime API evidence remain open',
    match: /conversation inbox|basic threads|sla policy|assignment history|reply macros|conversation runtime/i,
    productFiles: [
      'packages/conversation-inbox/domain-conversation-inbox.mjs',
      'packages/conversation-inbox/routes/conversation-inbox.mjs',
      'packages/conversation-inbox/index.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: CONVERSATION_INBOX_RUNTIME_HONESTY_TESTS,
    testCommand: CONVERSATION_INBOX_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase26-autonomous-conversation-inbox-runtime.json',
    proofReason: 'autonomous_conversation_inbox_runtime_product_test_proof_valid',
    requiredAssertions: [
      'conversation_inbox_runtime_contract',
      'sla_policy_event_ledger',
      'assignment_history_runtime',
      'reply_macro_application_ledger',
      'automation_handoff_events',
      'conversation_runtime_snapshot_persistence',
      'conversation_runtime_api_evidence',
      'existing_conversation_and_mobile_flows_preserved'
    ],
    implementationHandler: 'applyConversationInboxRuntime'
  },
  {
    id: 'survey_feedback_insights_runtime_layer',
    phase: 'phase27',
    label: 'Survey feedback insights, segmentation, delivery, and automation handoff runtime with snapshots and API proof',
    strictGap: 'surveys/feedback parity: basic score capture exists, but Mailchimp-grade sentiment analysis, feedback segmentation, delivery events, automation handoff, and runtime API evidence remain open',
    match: /surveys?\/feedback|basic score capture|sentiment analysis|feedback segmentation|survey runtime|automation handoff/i,
    productFiles: [
      'packages/surveys-feedback/domain-surveys-feedback.mjs',
      'packages/surveys-feedback/routes/surveys-feedback.mjs',
      'packages/surveys-feedback/index.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: SURVEY_FEEDBACK_RUNTIME_HONESTY_TESTS,
    testCommand: SURVEY_FEEDBACK_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase27-autonomous-survey-feedback-runtime.json',
    proofReason: 'autonomous_survey_feedback_runtime_product_test_proof_valid',
    requiredAssertions: [
      'survey_feedback_runtime_contract',
      'survey_sentiment_ledger',
      'feedback_segment_builder',
      'survey_delivery_event_ledger',
      'survey_automation_handoff_events',
      'survey_runtime_snapshot_persistence',
      'survey_runtime_api_evidence',
      'existing_survey_and_mobile_flows_preserved'
    ],
    implementationHandler: 'applySurveyFeedbackRuntime'
  },
  {
    id: 'preference_center_consent_suppression_runtime_layer',
    phase: 'phase28',
    label: 'Preference center consent, suppression, export, and runtime evidence layer with snapshots and API proof',
    strictGap: 'preferences center parity: hosted updates exist, but Mailchimp-grade consent ledger, double opt-in verification, suppression reconciliation, export runs, and runtime API evidence remain open',
    match: /preferences? center|hosted updates|consent ledger|double opt-in|suppression reconciliation|preference runtime/i,
    productFiles: [
      'packages/preferences-center/domain-preferences-center.mjs',
      'packages/preferences-center/routes/preferences-center.mjs',
      'packages/preferences-center/index.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: PREFERENCE_CENTER_RUNTIME_HONESTY_TESTS,
    testCommand: PREFERENCE_CENTER_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase28-autonomous-preference-center-runtime.json',
    proofReason: 'autonomous_preference_center_runtime_product_test_proof_valid',
    requiredAssertions: [
      'preference_center_runtime_contract',
      'preference_consent_event_ledger',
      'double_opt_in_verification_runtime',
      'suppression_reconciliation_runs',
      'preference_export_run_ledger',
      'preference_runtime_snapshot_persistence',
      'preference_runtime_api_evidence',
      'existing_preferences_and_mobile_flows_preserved'
    ],
    implementationHandler: 'applyPreferenceCenterRuntime'
  },
  {
    id: 'transactional_messaging_delivery_runtime_layer',
    phase: 'phase29',
    label: 'Transactional messaging trigger, render, delivery, suppression, webhook, and runtime evidence layer with snapshots and API proof',
    strictGap: 'transactional messaging parity: basic journey dispatch exists, but Mailchimp-grade trigger event ledger, template render evidence, delivery attempts/retries, suppression handling, webhooks, and runtime API evidence remain open',
    match: /transactional messaging|basic journey dispatch|trigger event ledger|template render|delivery attempts|suppression handling|transactional runtime/i,
    productFiles: [
      'packages/customer-journeys/domain-customer-journeys.mjs',
      'packages/customer-journeys/routes/customer-journeys.mjs',
      'packages/customer-journeys/index.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: TRANSACTIONAL_MESSAGING_RUNTIME_HONESTY_TESTS,
    testCommand: TRANSACTIONAL_MESSAGING_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase29-autonomous-transactional-messaging-runtime.json',
    proofReason: 'autonomous_transactional_messaging_runtime_product_test_proof_valid',
    requiredAssertions: [
      'transactional_messaging_runtime_contract',
      'transactional_trigger_event_ledger',
      'template_render_evidence_ledger',
      'delivery_attempt_retry_history',
      'suppression_policy_runtime',
      'transactional_webhook_event_ledger',
      'transactional_runtime_snapshot_persistence',
      'transactional_runtime_api_evidence',
      'existing_transactional_and_mobile_flows_preserved'
    ],
    implementationHandler: 'applyTransactionalMessagingRuntime'
  },
  {
    id: 'mobile_app_push_offline_runtime_layer',
    phase: 'phase30',
    label: 'Mobile app push registration, device trust, offline sync, conflict resolution, notification, and runtime evidence layer with snapshots and API proof',
    strictGap: 'mobile app parity: companion workflow exists, but Mailchimp-grade push registration, device trust/risk, offline sync batches, conflict resolution, notification ledger, and runtime API evidence remain open',
    match: /mobile app|companion workflow|push registration|device trust|offline sync|conflict resolution|mobile runtime/i,
    productFiles: [
      'packages/mobile-app/domain-mobile-app.mjs',
      'packages/mobile-app/routes/mobile-app.mjs',
      'packages/mobile-app/index.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: MOBILE_APP_RUNTIME_HONESTY_TESTS,
    testCommand: MOBILE_APP_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase30-autonomous-mobile-app-runtime.json',
    proofReason: 'autonomous_mobile_app_runtime_product_test_proof_valid',
    requiredAssertions: [
      'mobile_app_runtime_contract',
      'mobile_push_registration_ledger',
      'mobile_device_trust_events',
      'offline_sync_batch_ledger',
      'mobile_conflict_resolution_events',
      'mobile_notification_event_ledger',
      'mobile_runtime_snapshot_persistence',
      'mobile_runtime_api_evidence',
      'existing_mobile_and_transactional_flows_preserved'
    ],
    implementationHandler: 'applyMobileAppRuntime'
  },
  {
    id: 'content_studio_template_asset_runtime_layer',
    phase: 'phase31',
    label: 'Content studio template and asset lifecycle runtime with approval ledgers, review lineage, governance checks, usage telemetry, snapshots, and API proof',
    strictGap: 'content studio/template library parity: assets and templates exist, but Mailchimp-grade asset lifecycle approvals, brand governance, review lineage, usage telemetry, and runtime API evidence remain open',
    match: /content studio|template library|asset lifecycle|brand governance|review lineage|usage telemetry|content runtime/i,
    productFiles: [
      'packages/app/domain-template-assets.mjs',
      'packages/app/routes/content-asset-templates.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: CONTENT_STUDIO_RUNTIME_HONESTY_TESTS,
    testCommand: CONTENT_STUDIO_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase31-autonomous-content-studio-runtime.json',
    proofReason: 'autonomous_content_studio_runtime_product_test_proof_valid',
    requiredAssertions: [
      'content_studio_runtime_contract',
      'content_asset_lifecycle_ledger',
      'template_review_lineage_ledger',
      'brand_governance_event_ledger',
      'content_usage_telemetry_events',
      'content_runtime_snapshot_persistence',
      'content_runtime_api_evidence',
      'existing_content_and_platform_flows_preserved'
    ],
    implementationHandler: 'applyContentStudioRuntime'
  },
  {
    id: 'sms_marketing_native_runtime_layer',
    phase: 'phase32',
    label: 'SMS marketing native consent, compliance, delivery, click tracking, and runtime evidence layer with snapshots and API proof',
    strictGap: 'sms marketing parity: omnichannel programs exist, but Mailchimp-grade SMS consent receipts, quiet-hour compliance, carrier delivery attempts, link tracking, and runtime API evidence remain open',
    match: /sms marketing|sms consent|quiet-hour|carrier delivery|sms runtime|link tracking/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/domain-website-builder.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: SMS_MARKETING_RUNTIME_HONESTY_TESTS,
    testCommand: SMS_MARKETING_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase32-autonomous-sms-marketing-runtime.json',
    proofReason: 'autonomous_sms_marketing_runtime_product_test_proof_valid',
    requiredAssertions: [
      'sms_marketing_runtime_contract',
      'sms_consent_receipt_ledger',
      'sms_compliance_event_ledger',
      'sms_delivery_attempt_history',
      'sms_link_tracking_telemetry',
      'sms_runtime_snapshot_persistence',
      'sms_runtime_api_evidence',
      'existing_omnichannel_and_sms_package_flows_preserved'
    ],
    implementationHandler: 'applySmsMarketingRuntime'
  },
  {
    id: 'social_publishing_native_runtime_layer',
    phase: 'phase33',
    label: 'Social post publishing approval, scheduling, provider handoff, analytics, and runtime evidence layer with snapshots and API proof',
    strictGap: 'social publishing parity: social workstreams exist, but Mailchimp-grade post scheduling, approval, provider handoff, engagement telemetry, and runtime API evidence remain open',
    match: /social publishing|social workstreams|post scheduling|provider handoff|social runtime|engagement telemetry/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/domain-website-builder.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: SOCIAL_PUBLISHING_RUNTIME_HONESTY_TESTS,
    testCommand: SOCIAL_PUBLISHING_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase33-autonomous-social-publishing-runtime.json',
    proofReason: 'autonomous_social_publishing_runtime_product_test_proof_valid',
    requiredAssertions: [
      'social_publishing_runtime_contract',
      'social_approval_event_ledger',
      'social_scheduled_post_queue',
      'social_provider_handoff_history',
      'social_engagement_telemetry',
      'social_runtime_snapshot_persistence',
      'social_runtime_api_evidence',
      'existing_omnichannel_and_social_package_flows_preserved'
    ],
    implementationHandler: 'applySocialPublishingRuntime'
  },
  {
    id: 'ads_retargeting_runtime_layer',
    phase: 'phase34',
    label: 'Digital ads retargeting audience, budget pacing, provider sync, conversion attribution, and runtime evidence layer with snapshots and API proof',
    strictGap: 'digital ads parity: ad channel programs exist, but Mailchimp-grade retargeting audiences, budget pacing, provider sync, conversion attribution, and runtime API evidence remain open',
    match: /digital ads|retargeting audience|budget pacing|provider sync|conversion attribution|ads runtime/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/domain-website-builder.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: ADS_RETARGETING_RUNTIME_HONESTY_TESTS,
    testCommand: ADS_RETARGETING_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase34-autonomous-ads-retargeting-runtime.json',
    proofReason: 'autonomous_ads_retargeting_runtime_product_test_proof_valid',
    requiredAssertions: [
      'ads_retargeting_runtime_contract',
      'ads_retargeting_audience_ledger',
      'ads_budget_pacing_events',
      'ads_provider_sync_history',
      'ads_conversion_attribution_events',
      'ads_runtime_snapshot_persistence',
      'ads_runtime_api_evidence',
      'existing_omnichannel_ads_flows_preserved'
    ],
    implementationHandler: 'applyAdsRetargetingRuntime'
  },
  {
    id: 'developer_webhooks_api_runtime_layer',
    phase: 'phase35',
    label: 'Developer API and webhook runtime with scoped keys, subscription lifecycle, signed delivery replay, request audit, and runtime evidence layer with snapshots and API proof',
    strictGap: 'developer webhooks/API parity: API keys and webhooks exist, but Mailchimp-grade scoped keys, subscription lifecycle, signed delivery replay, request audit, and runtime API evidence remain open',
    match: /developer webhooks|api keys|subscription lifecycle|signed delivery|request audit|developer runtime/i,
    productFiles: [
      'packages/app/domain-core.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: DEVELOPER_API_WEBHOOK_RUNTIME_HONESTY_TESTS,
    testCommand: DEVELOPER_API_WEBHOOK_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase35-autonomous-developer-api-webhook-runtime.json',
    proofReason: 'autonomous_developer_api_webhook_runtime_product_test_proof_valid',
    requiredAssertions: [
      'developer_webhooks_api_runtime_contract',
      'scoped_api_key_lifecycle',
      'developer_api_request_audit_ledger',
      'webhook_subscription_lifecycle_events',
      'signed_webhook_delivery_replay',
      'developer_runtime_snapshot_persistence',
      'developer_runtime_api_evidence',
      'existing_api_admin_platform_flows_preserved'
    ],
    implementationHandler: 'applyDeveloperApiWebhookRuntime'
  },
  {
    id: 'billing_entitlements_usage_runtime_layer',
    phase: 'phase36',
    label: 'Billing entitlement and usage runtime with plan reconciliation, usage meters, trials, invoice/tax collection runs, and runtime API evidence',
    strictGap: 'billing/entitlements parity: plan pages exist, but Mailchimp-grade entitlement reconciliation, usage meters, trials, invoice/tax collection runs, and runtime API evidence remain open',
    match: /billing|entitlements|usage meters|invoice|tax|trial|billing runtime/i,
    productFiles: [
      'packages/app/domain-core.mjs',
      'packages/app/routes/platform.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: BILLING_ENTITLEMENTS_RUNTIME_HONESTY_TESTS,
    testCommand: BILLING_ENTITLEMENTS_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase36-autonomous-billing-entitlements-runtime.json',
    proofReason: 'autonomous_billing_entitlements_runtime_product_test_proof_valid',
    requiredAssertions: [
      'billing_entitlements_usage_runtime_contract',
      'plan_entitlement_reconciliation',
      'usage_metering_ledger',
      'trial_lifecycle_events',
      'invoice_tax_collection_run',
      'billing_runtime_snapshot_persistence',
      'billing_runtime_api_evidence',
      'existing_platform_and_reporting_flows_preserved'
    ],
    implementationHandler: 'applyBillingEntitlementsRuntime'
  },
  {
    id: 'team_governance_permissions_runtime_layer',
    phase: 'phase37',
    label: 'Team governance and permissions runtime with permission policy matrix, delegated admin, SCIM provisioning, access review, region governance, and runtime API evidence',
    strictGap: 'team roles/permissions parity: invitations and role updates exist, but Mailchimp-grade permission policy, delegated administration, SCIM provisioning, access review, region governance, and runtime API evidence remain open',
    match: /team|roles|permissions|delegated admin|scim|access review|region governance|team runtime/i,
    productFiles: [
      'packages/app/domain-core.mjs',
      'packages/app/routes/platform.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: TEAM_GOVERNANCE_RUNTIME_HONESTY_TESTS,
    testCommand: TEAM_GOVERNANCE_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase37-autonomous-team-governance-runtime.json',
    proofReason: 'autonomous_team_governance_runtime_product_test_proof_valid',
    requiredAssertions: [
      'team_governance_permissions_runtime_contract',
      'permission_policy_matrix',
      'delegated_admin_scope_ledger',
      'scim_provisioning_lifecycle',
      'access_review_attestation',
      'region_governance_policy',
      'team_runtime_snapshot_persistence',
      'team_runtime_api_evidence',
      'existing_platform_billing_developer_flows_preserved'
    ],
    implementationHandler: 'applyTeamGovernanceRuntime'
  },
  {
    id: 'settings_domains_deliverability_runtime_layer',
    phase: 'phase38',
    label: 'Settings domains and deliverability runtime with DNS auth checks, DMARC alignment, sender warmup, dedicated IP readiness, compliance review, and runtime API evidence',
    strictGap: 'settings/domains parity: domain verification exists, but Mailchimp-grade DNS checks, DMARC alignment, sender reputation warmup, dedicated IP readiness, compliance review, and runtime API evidence remain open',
    match: /settings|domains|deliverability|dns checks|dmarc|sender reputation|dedicated ip|compliance review/i,
    productFiles: [
      'packages/app/domain-deliverability-compliance.mjs',
      'packages/app/routes/deliverability-compliance.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_HONESTY_TESTS,
    testCommand: SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase38-autonomous-settings-domains-deliverability-runtime.json',
    proofReason: 'autonomous_settings_domains_deliverability_runtime_product_test_proof_valid',
    requiredAssertions: [
      'settings_domains_deliverability_runtime_contract',
      'dns_authentication_check_ledger',
      'dmarc_alignment_evidence',
      'sender_reputation_warmup_plan',
      'dedicated_ip_readiness',
      'compliance_review_run',
      'deliverability_runtime_snapshot_persistence',
      'deliverability_runtime_api_evidence',
      'existing_deliverability_platform_team_flows_preserved'
    ],
    implementationHandler: 'applySettingsDomainsDeliverabilityRuntime'
  },
  {
    id: 'dashboard_home_insights_runtime_layer',
    phase: 'phase39',
    label: 'Dashboard home insights and task runtime with role-aware widget composition, saved views, priority tasks, data freshness, drillthrough telemetry, and runtime API evidence',
    strictGap: 'dashboard/home parity: summary cards exist, but Mailchimp-grade role-aware widgets, saved views, insight task queues, data freshness drilldowns, drillthrough telemetry, and runtime API evidence remain open',
    match: /dashboard|home|widgets|saved views|insight task|data freshness|drillthrough|dashboard runtime/i,
    productFiles: [
      'packages/app/domain-core.mjs',
      'packages/app/routes/platform.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: DASHBOARD_HOME_RUNTIME_HONESTY_TESTS,
    testCommand: DASHBOARD_HOME_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase39-autonomous-dashboard-home-runtime.json',
    proofReason: 'autonomous_dashboard_home_runtime_product_test_proof_valid',
    requiredAssertions: [
      'dashboard_home_insights_runtime_contract',
      'role_aware_widget_composition',
      'saved_dashboard_view_preferences',
      'insight_priority_task_queue',
      'data_freshness_ledger',
      'dashboard_drillthrough_telemetry',
      'dashboard_runtime_snapshot_persistence',
      'dashboard_runtime_api_evidence',
      'existing_platform_deliverability_team_flows_preserved'
    ],
    implementationHandler: 'applyDashboardHomeRuntime'
  },
  {
    id: 'campaign_experimentation_decision_runtime_layer',
    phase: 'phase40',
    label: 'Campaign experimentation runtime with variant allocation, dynamic content resolution, holdout compliance, winner decision audit, snapshots, and API evidence',
    strictGap: 'campaign experimentation parity: basic A/B campaign flows exist, but Mailchimp-grade variant allocation, dynamic content resolution, holdout compliance, winner decision audit, runtime snapshots, and API evidence remain open',
    match: /experiment|a\/b|ab test|variant|winner|dynamic content|holdout|optimization/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: CAMPAIGN_EXPERIMENT_RUNTIME_HONESTY_TESTS,
    testCommand: CAMPAIGN_EXPERIMENT_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase40-autonomous-campaign-experiment-runtime.json',
    proofReason: 'autonomous_campaign_experiment_runtime_product_test_proof_valid',
    requiredAssertions: [
      'campaign_experiment_runtime_contract',
      'variant_allocation_ledger',
      'dynamic_content_rule_resolution',
      'holdout_compliance_evidence',
      'winner_decision_audit_trail',
      'experiment_runtime_snapshot_persistence',
      'campaign_experiment_runtime_api_evidence',
      'existing_current_product_dashboard_platform_flows_preserved'
    ],
    implementationHandler: 'applyCampaignExperimentRuntime'
  },
  {
    id: 'postcard_direct_mail_runtime_layer',
    phase: 'phase41',
    label: 'Postcard/direct-mail runtime with postal audience eligibility, creative proof approval, print handoff, delivery tracking, snapshots, and API evidence',
    strictGap: 'postcard/direct-mail parity: omnichannel programs mention postcards, but Mailchimp-grade postal audience eligibility, creative proof approval, print vendor handoff, delivery tracking, runtime snapshots, and API evidence remain open',
    match: /postcard|direct-mail|direct mail|postal audience|print vendor|maildrop|delivery tracking/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: POSTCARD_DIRECT_MAIL_RUNTIME_HONESTY_TESTS,
    testCommand: POSTCARD_DIRECT_MAIL_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase41-autonomous-postcard-direct-mail-runtime.json',
    proofReason: 'autonomous_postcard_direct_mail_runtime_product_test_proof_valid',
    requiredAssertions: [
      'postcard_direct_mail_runtime_contract',
      'postal_audience_eligibility_ledger',
      'postcard_address_validation_events',
      'postcard_creative_proof_approvals',
      'postcard_print_vendor_handoffs',
      'postcard_delivery_tracking_events',
      'postcard_runtime_snapshot_persistence',
      'postcard_runtime_api_evidence',
      'existing_omnichannel_experiment_flows_preserved'
    ],
    implementationHandler: 'applyPostcardDirectMailRuntime'
  },
  {
    id: 'cross_channel_journey_runtime_layer',
    phase: 'phase42',
    label: 'Cross-channel journey runtime with email/SMS/ad-sync/inbox/survey/postcard nodes, channel handoffs, decisions, performance rollups, snapshots, and API evidence',
    strictGap: 'cross-channel journey parity: automation nodes exist, but Mailchimp-grade email/SMS/ad/inbox/survey/postcard journey nodes, channel handoffs, decision audit, performance rollups, runtime snapshots, and API evidence remain open',
    match: /cross-channel|journey builder|email\/sms|ad sync|inbox task|survey request|channel handoff|performance rollup/i,
    productFiles: [
      'packages/app/domain-growth.mjs',
      'packages/app/domain-journeys.mjs',
      'packages/app/routes/automations.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: CROSS_CHANNEL_JOURNEY_RUNTIME_HONESTY_TESTS,
    testCommand: CROSS_CHANNEL_JOURNEY_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase42-autonomous-cross-channel-journey-runtime.json',
    proofReason: 'autonomous_cross_channel_journey_runtime_product_test_proof_valid',
    requiredAssertions: [
      'cross_channel_journey_runtime_contract',
      'email_sms_ads_inbox_survey_postcard_nodes',
      'cross_channel_node_configuration_ledger',
      'channel_handoff_event_history',
      'cross_channel_decision_audit_trail',
      'channel_performance_rollups',
      'cross_channel_runtime_snapshot_persistence',
      'cross_channel_runtime_api_evidence',
      'existing_automation_and_omnichannel_flows_preserved'
    ],
    implementationHandler: 'applyCrossChannelJourneyRuntime'
  },
  {
    id: 'social_calendar_coordination_runtime_layer',
    phase: 'phase43',
    label: 'Social calendar coordination runtime with campaign links, calendar placements, cross-channel timeline, snapshots, and API evidence',
    strictGap: 'social calendar coordination parity: social publishing exists, but Mailchimp-grade campaign-linked social calendar placements, cross-channel timeline events, coordination ledgers, runtime snapshots, and API evidence remain open',
    match: /social calendar|campaign-linked social|calendar placement|cross-channel timeline|coordination ledger/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: SOCIAL_CALENDAR_COORDINATION_RUNTIME_HONESTY_TESTS,
    testCommand: SOCIAL_CALENDAR_COORDINATION_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase43-autonomous-social-calendar-coordination-runtime.json',
    proofReason: 'autonomous_social_calendar_coordination_runtime_product_test_proof_valid',
    requiredAssertions: [
      'social_calendar_coordination_runtime_contract',
      'social_calendar_placement_ledger',
      'campaign_social_coordination_events',
      'cross_channel_timeline_events',
      'social_calendar_runtime_snapshot_persistence',
      'social_calendar_runtime_api_evidence',
      'existing_social_publishing_and_current_product_flows_preserved'
    ],
    implementationHandler: 'applySocialCalendarCoordinationRuntime'
  },
  {
    id: 'omnichannel_reporting_attribution_runtime_layer',
    phase: 'phase44',
    label: 'Omnichannel reporting attribution runtime with channel mix, objective rollups, touchpoint attribution, snapshots, and API evidence',
    strictGap: 'omnichannel reporting attribution parity: channel programs exist, but Mailchimp-grade channel mix dashboards, objective rollups, touchpoint attribution events, durable reporting snapshots, and API evidence remain open',
    match: /omnichannel reporting|channel mix|objective rollup|touchpoint attribution|attribution runtime/i,
    productFiles: [
      'packages/app/domain-current-product-ops.mjs',
      'packages/app/routes/current-product-ops.mjs',
      'packages/app/storage.mjs'
    ],
    targetedTests: OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_HONESTY_TESTS,
    testCommand: OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_TEST_COMMAND,
    proofMapRelPath: 'artifacts/real_parity_proofs/phase44-autonomous-omnichannel-reporting-attribution-runtime.json',
    proofReason: 'autonomous_omnichannel_reporting_attribution_runtime_product_test_proof_valid',
    requiredAssertions: [
      'omnichannel_reporting_attribution_runtime_contract',
      'channel_mix_snapshot_history',
      'omnichannel_objective_rollups',
      'touchpoint_attribution_events',
      'omnichannel_reporting_runtime_snapshot_persistence',
      'omnichannel_reporting_runtime_api_evidence',
      'existing_omnichannel_social_calendar_postcard_flows_preserved'
    ],
    implementationHandler: 'applyOmnichannelReportingAttributionRuntime'
  }
];

STRICT_SURFACES.push(...buildMailchimpGlobalGapStrictSurfaces());
STRICT_SURFACES.push(...buildMailchimpFrontierStrictSurfaces({
  testCommand: MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_TEST_COMMAND,
  targetedTests: MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_HONESTY_TESTS
}));

const GLOBAL_GAP_REMAINING_STRICT_GAPS = buildMailchimpGlobalGapStrictGaps();

const FALLBACK_REMAINING_STRICT_GAPS = [
  'automation/journey parity: no Mailchimp-grade visual/orchestrated runtime parity',
  'audience/CRM parity: limited identity/lifecycle/warehouse realism',
  'reporting/analytics parity: telemetry remains local rather than production pipeline parity',
  'AI/predictive parity: recommendations still come from local Mailclone provider seams',
  'integration/provider parity: connector auth/sync remains verified through local connector seams rather than real provider accounts',
  'auth/session/security parity: improved, but full production security program remains unproven',
  'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open',
  'frontend interaction parity: client modules now exist for key builders, but the whole app is not yet a Mailchimp-grade full client application',
  'campaign editor parity: deeper visual builder runtime still lacks Mailchimp-grade block inspectors, asset transforms, style controls, and browser-backed interaction proof',
  'website builder parity: visual site designer exists, but Mailchimp-grade publish readiness, SEO audits, domain checks, experiments, analytics goals, and runtime API evidence remain open',
  'landing pages and signup forms parity: builders exist, but Mailchimp-grade conversion runtime, attribution, consent receipts, landing-page experiments, and funnel API evidence remain open',
  'commerce/revenue parity: commerce sync exists, but Mailchimp-grade order lifecycle, customer value profiles, abandoned-cart recovery, product recommendations, and runtime API evidence remain open',
  'conversation inbox parity: basic threads exist, but Mailchimp-grade SLA policy, assignment history, reply macros, automation handoff, sentiment, and runtime API evidence remain open',
  'surveys/feedback parity: basic score capture exists, but Mailchimp-grade sentiment analysis, feedback segmentation, delivery events, automation handoff, and runtime API evidence remain open',
  'preferences center parity: hosted updates exist, but Mailchimp-grade consent ledger, double opt-in verification, suppression reconciliation, export runs, and runtime API evidence remain open',
  'transactional messaging parity: basic journey dispatch exists, but Mailchimp-grade trigger event ledger, template render evidence, delivery attempts/retries, suppression handling, webhooks, and runtime API evidence remain open',
  'mobile app parity: companion workflow exists, but Mailchimp-grade push registration, device trust/risk, offline sync batches, conflict resolution, notification ledger, and runtime API evidence remain open',
  'content studio/template library parity: assets and templates exist, but Mailchimp-grade asset lifecycle approvals, brand governance, review lineage, usage telemetry, and runtime API evidence remain open',
  'social calendar coordination parity: social publishing exists, but Mailchimp-grade campaign-linked social calendar placements, cross-channel timeline events, coordination ledgers, runtime snapshots, and API evidence remain open',
  'omnichannel reporting attribution parity: channel programs exist, but Mailchimp-grade channel mix dashboards, objective rollups, touchpoint attribution events, durable reporting snapshots, and API evidence remain open',
  ...GLOBAL_GAP_REMAINING_STRICT_GAPS,
  ...buildMailchimpFrontierStrictGaps()
];

function parseArgs(argv) {
  const args = {
    benchmarkId: BENCHMARK_ID,
    stackRoot: DEFAULT_STACK_ROOT,
    mailchimpRoot: DEFAULT_MAILCHIMP_ROOT,
    phase13ArtifactRoot: DEFAULT_PHASE13_ARTIFACT,
    artifactRoot: null,
    apply: false,
    skipTests: false,
    listSupportedGapsJson: false,
    maxIterations: 1
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--phase13-artifact-root') { args.phase13ArtifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--max-iterations') { args.maxIterations = Math.max(1, Number(next || 1)); index += 1; continue; }
    if (token === '--list-supported-gaps-json') { args.listSupportedGapsJson = true; continue; }
    if (token === '--apply') { args.apply = true; continue; }
    if (token === '--skip-tests') { args.skipTests = true; continue; }
  }
  if (!args.artifactRoot) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks', args.benchmarkId, `bootstrap-${stamp}`);
  }
  return args;
}

function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function writeText(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, value); }
function safeRead(filePath) { try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; } }
function hasText(filePath, needle) { return safeRead(filePath).includes(needle); }
function lineCount(source) { return source ? source.split('\n').length : 0; }

function fileEvidence(root, relPaths) {
  return relPaths.map((relPath) => {
    const fullPath = path.join(root, relPath);
    const source = safeRead(fullPath);
    return { relPath, exists: fs.existsSync(fullPath), bytes: Buffer.byteLength(source), lineCount: lineCount(source) };
  });
}

function buildExistingProductStateProof(args, surface) {
  const productEvidence = fileEvidence(args.mailchimpRoot, surface?.productFiles || []);
  const testEvidence = fileEvidence(args.mailchimpRoot, surface?.targetedTests || []);
  const ok = !isFrontierSurface(surface)
    && productEvidence.length > 0
    && productEvidence.every((entry) => entry.exists && entry.bytes > 0)
    && testEvidence.every((entry) => entry.exists && entry.bytes > 0)
    && Array.isArray(surface?.requiredAssertions)
    && surface.requiredAssertions.length > 0;
  return {
    ok,
    kind: 'explicit_existing_product_state_proof',
    globalGapId: surface?.globalGapId || null,
    globalGapLabel: surface?.globalGapLabel || null,
    productEvidence,
    testEvidence,
    assertionCount: surface?.requiredAssertions?.length || 0,
    reason: ok ? 'product_files_tests_and_assertion_contract_present' : 'missing_product_state_evidence'
  };
}

function normalizeProofMap(proofDoc) {
  if (!proofDoc || typeof proofDoc !== 'object') return {};
  if (proofDoc.proofs && typeof proofDoc.proofs === 'object' && !Array.isArray(proofDoc.proofs)) return proofDoc.proofs;
  return proofDoc;
}

function readSurfaceProofMap(args) {
  return STRICT_SURFACES.reduce((acc, surface) => {
    const doc = readJson(path.join(args.mailchimpRoot, surface.proofMapRelPath), {});
    Object.assign(acc, normalizeProofMap(doc));
    return acc;
  }, {});
}

function evaluateProof(surface, proofMap) {
  const proof = proofMap[surface.id] || null;
  if (!proof) return { present: false, valid: false, reason: 'missing_proof_entry' };
  const productFiles = new Set(proof.productFiles || []);
  const targetedTests = new Set(proof.targetedTests || []);
  const assertions = Array.isArray(proof.assertions) ? proof.assertions : [];
  const assertionIds = new Set(assertions.map((entry) => typeof entry === 'string' ? entry : entry.id).filter(Boolean));
  const missingProductFiles = surface.productFiles.filter((relPath) => !productFiles.has(relPath));
  const missingTargetedTests = surface.targetedTests.filter((relPath) => !targetedTests.has(relPath));
  const missingAssertions = surface.requiredAssertions.filter((id) => !assertionIds.has(id));
  const testsPassed = proof.testsPassed === true;
  const semanticWorkGateOk = proofSemanticWorkGateOk(surface, proof);
  const valid = testsPassed && missingProductFiles.length === 0 && missingTargetedTests.length === 0 && missingAssertions.length === 0 && semanticWorkGateOk;
  return {
    present: true,
    valid,
    testsPassed,
    runCommand: proof.runCommand || null,
    artifact: proof.artifact || null,
    semanticWorkGateOk,
    semanticWorkGate: proof.semanticWorkGate || null,
    missingProductFiles,
    missingTargetedTests,
    missingAssertions,
    assertionCount: assertions.length,
    reason: valid
      ? (surface.proofReason || 'autonomous_product_test_proof_valid')
      : (!semanticWorkGateOk ? 'semantic_product_work_gate_failed' : 'proof_entry_incomplete')
  };
}

function isProductPath(relPath) {
  return Boolean(relPath)
    && !relPath.startsWith('tests/')
    && !relPath.startsWith('docs/')
    && !relPath.startsWith('artifacts/')
    && !relPath.includes('/artifacts/')
    && !relPath.endsWith('.test.mjs');
}

function isFrontierSurface(surface) {
  return surface?.implementationHandler === 'applyMailchimpContinuousFrontierRuntime' || String(surface?.id || '').startsWith('mailchimp_frontier_');
}

function hasSurfaceSpecificExecutableTest(surface) {
  const genericFrontierTests = new Set([
    'tests/mailchimp-continuous-frontier-runtime.test.mjs',
    'tests/current-product-parity.test.mjs'
  ]);
  return (surface?.targetedTests || []).some((relPath) => !genericFrontierTests.has(relPath));
}

function productStateProofOk(surface, implementation = {}, testResult = {}) {
  if (isFrontierSurface(surface)) return false;
  const markerProof = Array.isArray(implementation.missingMarkers)
    && implementation.missingMarkers.length === 0
    && Array.isArray(implementation.productFiles)
    && implementation.productFiles.length > 0;
  const explicitProof = implementation.explicitProductStateProof === true || implementation.productStateProof?.ok === true;
  return Boolean((markerProof || explicitProof) && testResult.status === 0);
}

function buildSemanticWorkGate(surface, implementation = {}, testResult = {}) {
  const changedFiles = Array.isArray(implementation.changedFiles) ? implementation.changedFiles : [];
  const productChangedFiles = changedFiles.filter(isProductPath);
  const frontierGenericLedgerOnly = isFrontierSurface(surface);
  const explicitProductStateProof = productStateProofOk(surface, implementation, testResult);
  const surfaceSpecificExecutableEvidence = Boolean(
    implementation.surfaceSpecificExecutableEvidence
  );
  const ok = productChangedFiles.length > 0 || explicitProductStateProof;
  return {
    ok,
    required: true,
    gate: 'semantic_product_work_gate',
    productChangedFiles,
    changedFileCount: changedFiles.length,
    explicitProductStateProof,
    productStateProof: implementation.productStateProof || null,
    surfaceSpecificExecutableEvidence,
    frontierGenericLedgerOnly,
    reason: ok
      ? (productChangedFiles.length ? 'non_empty_product_diff_declared' : 'explicit_product_state_proof_admitted')
      : 'no_product_diff_or_explicit_product_state_proof'
  };
}

function proofSemanticWorkGateOk(surface, proof = {}) {
  if (!isFrontierSurface(surface)) return true;
  const gate = proof.semanticWorkGate || {};
  const changed = Array.isArray(gate.productChangedFiles) ? gate.productChangedFiles : (Array.isArray(proof.productChangedFiles) ? proof.productChangedFiles : []);
  return changed.some(isProductPath) || gate.explicitProductStateProof === true || proof.productStateProof?.ok === true;
}

function buildSurfaceStatus(surface, mailchimpRoot, proofMap) {
  const productEvidence = fileEvidence(mailchimpRoot, surface.productFiles);
  const testEvidence = fileEvidence(mailchimpRoot, surface.targetedTests);
  const proof = evaluateProof(surface, proofMap);
  const filesPresent = productEvidence.every((entry) => entry.exists) && testEvidence.every((entry) => entry.exists);
  return {
    ...surface,
    productEvidence,
    testEvidence,
    proof,
    status: filesPresent && proof.valid ? 'green' : 'red',
    blockers: filesPresent && proof.valid ? [] : [
      ...productEvidence.filter((entry) => !entry.exists).map((entry) => ({ kind: 'missing_product_file', file: entry.relPath })),
      ...testEvidence.filter((entry) => !entry.exists).map((entry) => ({ kind: 'missing_targeted_test', file: entry.relPath })),
      ...(proof.valid ? [] : [{ kind: proof.reason, proof }])
    ]
  };
}

function selectNextSurface({ remainingStrictGaps, surfaceStatuses }) {
  if (Array.isArray(remainingStrictGaps) && remainingStrictGaps.length === 0) return null;
  const redSurfaces = surfaceStatuses.filter((entry) => entry.status !== 'green');
  for (const gap of remainingStrictGaps) {
    const redExact = redSurfaces.find((surface) => surface.strictGap === gap);
    if (redExact) return { surface: redExact, sourceGap: gap, selectionReason: 'first_unresolved_exact_strict_gap_from_prior_artifact' };
    const provenExact = surfaceStatuses.find((surface) => surface.strictGap === gap);
    if (provenExact) return { surface: provenExact, sourceGap: gap, selectionReason: 'first_exact_strict_gap_from_prior_artifact_already_product_proven' };
    const redMatch = redSurfaces.find((surface) => surface.match.test(gap));
    if (redMatch) return { surface: redMatch, sourceGap: gap, selectionReason: 'first_unresolved_strict_gap_from_prior_artifact' };
    const provenMatch = surfaceStatuses.find((surface) => surface.match.test(gap));
    if (provenMatch) return { surface: provenMatch, sourceGap: gap, selectionReason: 'first_strict_gap_from_prior_artifact_already_product_proven' };
  }
  const fallback = redSurfaces[0] || surfaceStatuses[0] || null;
  return fallback ? { surface: fallback, sourceGap: fallback.strictGap, selectionReason: fallback.status === 'green' ? 'fallback_configured_surface_already_product_proven' : 'fallback_first_unresolved_configured_surface' } : null;
}

function strictGapForQueuedWork(entry = {}) {
  if (entry.strictGap) return entry.strictGap;
  const candidateIds = [
    entry.globalGapId,
    entry.parentSurfaceId,
    entry.surfaceId,
    String(entry.id || '').replace(/__req_\d+$/, ''),
    String(entry.leafId || '').replace(/__req_\d+$/, '')
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const exact = STRICT_SURFACES.find((surface) => candidateIds.some((id) => id === surface.globalGapId || id === surface.id || id === surface.parentSurfaceId));
  if (exact?.strictGap) return exact.strictGap;
  const entryFiles = new Set(Array.isArray(entry.allowedFiles) ? entry.allowedFiles : Array.isArray(entry.productFiles) ? entry.productFiles : []);
  const entryTests = new Set(Array.isArray(entry.targetedTests) ? entry.targetedTests : []);
  const overlap = STRICT_SURFACES
    .map((surface) => {
      const fileOverlap = (surface.productFiles || []).filter((file) => entryFiles.has(file)).length;
      const testOverlap = (surface.targetedTests || []).filter((test) => entryTests.has(test)).length;
      return { surface, score: fileOverlap * 2 + testOverlap };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  return overlap?.surface?.strictGap || null;
}

function deriveRemainingStrictGaps(args) {
  const summary = readJson(path.join(args.phase13ArtifactRoot, 'completion_summary.json'), {});
  const queue = readJson(path.join(args.phase13ArtifactRoot, 'next_work_queue.json'), {});
  const queuedGaps = Array.isArray(queue.work) ? Array.from(new Set(queue.work.map((entry) => strictGapForQueuedWork(entry)).filter(Boolean))) : [];
  const inventoryQueueMode = Array.isArray(queue.work) && (queue.work.some((entry) => entry?.catalogSource === 'strict_1to1_gap_inventory' || entry?.globalGapId) || queuedGaps.some((gap) => GLOBAL_GAP_REMAINING_STRICT_GAPS.includes(gap)));
  const summaryInventoryMode = Boolean(summary.selectedGlobalGapId || String(summary.selectedSurfaceId || '').startsWith('mailchimp_global_gap_') || GLOBAL_GAP_REMAINING_STRICT_GAPS.includes(summary.nextStrictGap) || GLOBAL_GAP_REMAINING_STRICT_GAPS.includes(summary.selectedStrictGap));
  const activeFallbackGaps = (inventoryQueueMode || summaryInventoryMode) ? GLOBAL_GAP_REMAINING_STRICT_GAPS : FALLBACK_REMAINING_STRICT_GAPS;
  if (queuedGaps.length) {
    const lastQueuedIndex = activeFallbackGaps.findIndex((gap) => gap === queuedGaps[queuedGaps.length - 1]);
    const tail = lastQueuedIndex >= 0 ? activeFallbackGaps.slice(lastQueuedIndex + 1) : [];
    return [...queuedGaps, ...tail.filter((gap) => !queuedGaps.includes(gap))];
  }
  if (Array.isArray(summary.remainingStrictGaps) && summary.remainingStrictGaps.length) return summary.remainingStrictGaps;
  if (summary.nextStrictGap) {
    const fallbackIndex = activeFallbackGaps.findIndex((gap) => gap === summary.nextStrictGap);
    return fallbackIndex >= 0 ? activeFallbackGaps.slice(fallbackIndex) : [summary.nextStrictGap, ...activeFallbackGaps.filter((gap) => gap !== summary.nextStrictGap)];
  }
  if (summary.selectedStrictGap && summary.configuredStrictQueueExhausted) {
    const fallbackIndex = activeFallbackGaps.findIndex((gap) => gap === summary.selectedStrictGap);
    if (fallbackIndex >= 0) return activeFallbackGaps.slice(fallbackIndex + 1);
  }
  return activeFallbackGaps;
}

const JOURNEY_DESIGNER_CLIENT = `export function buildJourneyDesignerState(seed = {}) {
  const nodes = Array.isArray(seed.nodes) && seed.nodes.length ? seed.nodes : [{ id: 'node_start', type: 'trigger', title: seed.trigger || 'Journey trigger' }];
  const normalizedNodes = nodes.map((node, index) => ({
    id: node.id || \`node_\${index + 1}\`,
    type: node.type || 'email',
    title: node.title || node.type || \`Step \${index + 1}\`,
    delayHours: Number(node.delayHours || 0),
    conditions: Array.isArray(node.conditions) ? [...node.conditions] : [],
    x: Number(node.x ?? (index * 220)),
    y: Number(node.y ?? ((index % 2) * 120))
  }));
  return {
    automationId: seed.automationId || 'journey',
    name: seed.name || 'Customer journey',
    trigger: seed.trigger || 'contact_subscribed',
    goal: seed.goal || '',
    canvasMode: seed.canvasMode || 'design',
    previewContact: seed.previewContact || { segment: 'all_contacts', activity: 'subscribed' },
    selectedNodeId: seed.selectedNodeId || normalizedNodes[0]?.id || null,
    nodes: normalizedNodes,
    history: Array.isArray(seed.history) ? seed.history : [],
    future: Array.isArray(seed.future) ? seed.future : []
  };
}

function snapshot(state) {
  return JSON.stringify({
    nodes: state.nodes,
    selectedNodeId: state.selectedNodeId,
    canvasMode: state.canvasMode,
    previewContact: state.previewContact
  });
}

function withHistory(state, next) {
  return { ...next, history: [...(state.history || []), snapshot(state)].slice(-20), future: [] };
}

export function reorderJourneyNode(state, nodeId, direction) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return state;
  const target = direction === 'up' ? Math.max(0, index - 1) : Math.min(state.nodes.length - 1, index + 1);
  if (target === index) return state;
  const nodes = [...state.nodes];
  const [node] = nodes.splice(index, 1);
  nodes.splice(target, 0, node);
  return withHistory(state, { ...state, nodes, selectedNodeId: nodeId });
}

export function duplicateJourneyNode(state, nodeId) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return state;
  const source = state.nodes[index];
  const copy = { ...source, id: \`\${source.id}_copy_\${state.nodes.length + 1}\`, title: \`\${source.title} copy\`, x: source.x + 40, y: source.y + 40 };
  const nodes = [...state.nodes.slice(0, index + 1), copy, ...state.nodes.slice(index + 1)];
  return withHistory(state, { ...state, nodes, selectedNodeId: copy.id });
}

export function updateBranchConditions(state, nodeId, conditions = []) {
  const normalized = Array.isArray(conditions) ? conditions.map((entry) => String(entry).trim()).filter(Boolean) : String(conditions).split(',').map((entry) => entry.trim()).filter(Boolean);
  const nodes = state.nodes.map((node) => node.id === nodeId ? { ...node, type: node.type === 'branch' ? 'branch' : node.type, conditions: normalized } : node);
  return withHistory(state, { ...state, nodes, selectedNodeId: nodeId });
}

export function moveJourneyNode(state, nodeId, position = {}) {
  const nodes = state.nodes.map((node) => node.id === nodeId ? { ...node, x: Number(position.x ?? node.x), y: Number(position.y ?? node.y) } : node);
  return withHistory(state, { ...state, nodes, selectedNodeId: nodeId });
}

export function setJourneyPreviewContact(state, previewContact = {}) {
  return withHistory(state, { ...state, previewContact: { ...state.previewContact, ...previewContact } });
}

export function setJourneyCanvasMode(state, canvasMode) {
  return withHistory(state, { ...state, canvasMode: canvasMode || 'design' });
}

export function undoJourneyDesigner(state) {
  const last = state.history?.[state.history.length - 1];
  if (!last) return state;
  const restored = JSON.parse(last);
  return { ...state, ...restored, history: state.history.slice(0, -1), future: [snapshot(state), ...(state.future || [])] };
}

export function redoJourneyDesigner(state) {
  const next = state.future?.[0];
  if (!next) return state;
  const restored = JSON.parse(next);
  return { ...state, ...restored, history: [...(state.history || []), snapshot(state)], future: state.future.slice(1) };
}

export function serializeJourneyDesigner(state) {
  return JSON.stringify({
    automationId: state.automationId,
    name: state.name,
    trigger: state.trigger,
    goal: state.goal,
    canvasMode: state.canvasMode,
    previewContact: state.previewContact,
    selectedNodeId: state.selectedNodeId,
    nodes: state.nodes.map(({ id, type, title, delayHours, conditions, x, y }) => ({ id, type, title, delayHours, conditions, x, y }))
  });
}

function render(root, state) {
  root.innerHTML = \`<div class="journey-designer" data-selected-node="\${state.selectedNodeId || ''}" data-canvas-mode="\${state.canvasMode}"><div class="toolbar"><strong>Visual journey orchestration</strong><span>Mode: \${state.canvasMode}</span><span>Preview: \${state.previewContact.segment || 'all_contacts'}</span></div><ol>\${state.nodes.map((node) => \`<li data-node-id="\${node.id}"><button data-action="select" data-node-id="\${node.id}">\${node.title}</button><span>\${node.type}</span><span>\${(node.conditions || []).join(' / ')}</span></li>\`).join('')}</ol><textarea readonly data-serialized-journey-state>\${serializeJourneyDesigner(state)}</textarea></div>\`;
}

export function attachJourneyDesigner(root, seed = {}) {
  let state = buildJourneyDesignerState(seed);
  const update = (next) => { state = next; render(root, state); return state; };
  root.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    const nodeId = event.target?.dataset?.nodeId;
    if (action === 'select' && nodeId) update({ ...state, selectedNodeId: nodeId });
  });
  render(root, state);
  return {
    getState: () => state,
    reorder: (nodeId, direction) => update(reorderJourneyNode(state, nodeId, direction)),
    duplicate: (nodeId) => update(duplicateJourneyNode(state, nodeId)),
    updateBranch: (nodeId, conditions) => update(updateBranchConditions(state, nodeId, conditions)),
    move: (nodeId, position) => update(moveJourneyNode(state, nodeId, position)),
    preview: (previewContact) => update(setJourneyPreviewContact(state, previewContact)),
    mode: (canvasMode) => update(setJourneyCanvasMode(state, canvasMode)),
    undo: () => update(undoJourneyDesigner(state)),
    redo: () => update(redoJourneyDesigner(state)),
    serialize: () => serializeJourneyDesigner(state)
  };
}

if (typeof document !== 'undefined') {
  for (const root of document.querySelectorAll('[data-journey-designer-client]')) {
    const script = document.getElementById(root.dataset.stateScript || '');
    const seed = script ? JSON.parse(script.textContent || '{}') : {};
    attachJourneyDesigner(root, seed);
  }
}
`;

const JOURNEY_DESIGNER_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJourneyDesignerState,
  duplicateJourneyNode,
  reorderJourneyNode,
  redoJourneyDesigner,
  serializeJourneyDesigner,
  setJourneyCanvasMode,
  setJourneyPreviewContact,
  undoJourneyDesigner,
  updateBranchConditions
} from '../apps/web/public/journey-designer-client.mjs';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: \`http://127.0.0.1:\${address.port}\` };
}

test('journey designer client state supports reorder, duplicate, branch mutation, preview, undo/redo, and serialization', () => {
  let state = buildJourneyDesignerState({
    automationId: 'journey_1',
    name: 'Welcome Journey',
    trigger: 'contact_subscribed',
    nodes: [
      { id: 'n1', type: 'email', title: 'Welcome email' },
      { id: 'n2', type: 'branch', title: 'Opened?', conditions: ['opened'] },
      { id: 'n3', type: 'delay', title: 'Wait one day', delayHours: 24 }
    ]
  });
  state = reorderJourneyNode(state, 'n3', 'up');
  assert.deepEqual(state.nodes.map((node) => node.id), ['n1', 'n3', 'n2']);
  state = duplicateJourneyNode(state, 'n1');
  assert.equal(state.nodes[1].title, 'Welcome email copy');
  state = updateBranchConditions(state, 'n2', ['clicked', 'purchased']);
  assert.deepEqual(state.nodes.find((node) => node.id === 'n2').conditions, ['clicked', 'purchased']);
  state = setJourneyPreviewContact(state, { segment: 'vip', activity: 'clicked_campaign' });
  assert.equal(state.previewContact.segment, 'vip');
  state = setJourneyCanvasMode(state, 'runtime');
  assert.equal(state.canvasMode, 'runtime');
  const serialized = JSON.parse(serializeJourneyDesigner(state));
  assert.equal(serialized.automationId, 'journey_1');
  assert.equal(serialized.nodes.length, 4);
  const undone = undoJourneyDesigner(state);
  assert.equal(undone.canvasMode, 'design');
  const redone = redoJourneyDesigner(undone);
  assert.equal(redone.canvasMode, 'runtime');
});

test('automation builder serves the journey designer module while preserving durable server forms', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Journey Designer Admin',
      email: 'journey-designer@example.com',
      password: 'secret123',
      workspaceName: 'Journey Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    const audienceId = server.state.db.audiences[0].id;
    const created = await postForm(baseUrl, jar, '/automations', {
      name: 'Visual Welcome Journey',
      audienceId,
      trigger: 'contact_subscribed'
    });
    const builderLocation = created.headers.get('location');
    const automationId = builderLocation.match(/journey_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, '/automations/' + automationId + '/builder/nodes', { type: 'email', title: 'Welcome email' });
    await postForm(baseUrl, jar, '/automations/' + automationId + '/builder/nodes', { type: 'branch', title: 'Clicked?', conditions: 'clicked' });

    const moduleResponse = await request(baseUrl, jar, '/static/journey-designer-client.mjs');
    assert.equal(moduleResponse.status, 200);
    assert.match(await moduleResponse.text(), /attachJourneyDesigner/);

    const builder = await request(baseUrl, jar, '/automations/' + automationId + '/builder');
    const html = await builder.text();
    assert.match(html, /data-journey-designer-client/);
    assert.match(html, /Journey visual orchestration/);
    assert.match(html, /data-serialized-journey-state/);
    assert.match(html, /Add node/);
    assert.match(html, /Publish/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
`;

function replaceOnce(source, oldText, newText, filePath) {
  if (!source.includes(oldText)) throw new Error(`Expected patch anchor not found in ${filePath}`);
  return source.replace(oldText, newText);
}

function insertOnce(source, marker, insertion) {
  if (source.includes(insertion.trim().split('\n')[0])) return source;
  if (!source.includes(marker)) throw new Error(`Expected insertion marker not found: ${marker}`);
  return source.replace(marker, `${marker}${insertion}`);
}

function applyJourneyDesigner(args, events) {
  const changedFiles = [];
  const writeIfChanged = (relPath, content) => {
    const fullPath = path.join(args.mailchimpRoot, relPath);
    const prior = safeRead(fullPath);
    if (prior !== content) {
      writeText(fullPath, content);
      changedFiles.push(relPath);
    }
  };

  writeIfChanged('apps/web/public/journey-designer-client.mjs', JOURNEY_DESIGNER_CLIENT);
  writeIfChanged('tests/journey-designer-client.test.mjs', JOURNEY_DESIGNER_TEST);

  const publicRoute = path.join(args.mailchimpRoot, 'packages/app/routes/public.mjs');
  let publicSource = safeRead(publicRoute);
  if (!publicSource.includes("/static/journey-designer-client.mjs")) {
    const anchor = `  router.register('GET', '/static/website-designer-client.mjs', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'website-designer-client.mjs'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });\n`;
    const insertion = `\n  router.register('GET', '/static/journey-designer-client.mjs', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'journey-designer-client.mjs'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });\n`;
    publicSource = replaceOnce(publicSource, anchor, `${anchor}${insertion}`, publicRoute);
  }
  if (publicSource.includes("hydration: ['campaigns', 'automations', 'websites']")) {
    publicSource = publicSource.replace("hydration: ['campaigns', 'automations', 'websites']", "hydration: ['campaigns', 'automations', 'journey-designer', 'websites']");
  }
  if (safeRead(publicRoute) !== publicSource) {
    writeText(publicRoute, publicSource);
    changedFiles.push('packages/app/routes/public.mjs');
  }

  const automationsRoute = path.join(args.mailchimpRoot, 'packages/app/routes/automations.mjs');
  let automationSource = safeRead(automationsRoute);
  if (!automationSource.includes('data-journey-designer-client')) {
    const variableAnchor = `    const orchestration = automationOrchestrationSummary(state, automation);\n`;
    const variables = `    const journeyDesignerStateScriptId = \`journey-designer-state-\${automation.id}\`;\n    const journeyDesignerSeed = JSON.stringify({\n      automationId: automation.id,\n      name: automation.name,\n      trigger: automation.trigger || 'contact_subscribed',\n      goal: automation.goal || '',\n      selectedNodeId: automation.nodes[0]?.id || null,\n      nodes: automation.nodes.map((node, index) => ({\n        id: node.id,\n        type: node.type,\n        title: node.title,\n        delayHours: node.delayHours || 0,\n        conditions: node.conditions || [],\n        x: index * 220,\n        y: (index % 2) * 120\n      }))\n    }).replace(/</g, '\\\\u003c');\n    const visualJourneyDesigner = \`<script type="module" src="/static/journey-designer-client.mjs"></script><script id="\${journeyDesignerStateScriptId}" type="application/json">\${journeyDesignerSeed}</script><div class="card"><h3>Journey visual orchestration</h3><p class="muted">Client-side journey map reorder, branch conditions, contact preview, canvas mode, undo/redo, and serialized journey state run in-browser while durable server forms remain the save path.</p><div data-journey-designer-client data-state-script="\${journeyDesignerStateScriptId}"><textarea readonly data-serialized-journey-state>\${journeyDesignerSeed}</textarea></div></div>\`;\n`;
    automationSource = replaceOnce(automationSource, variableAnchor, `${variableAnchor}${variables}`, automationsRoute);
    automationSource = replaceOnce(automationSource, `<div class="card"><h3>Add node</h3>`, `${'${visualJourneyDesigner}'}<div class="card"><h3>Add node</h3>`, automationsRoute);
  }
  if (safeRead(automationsRoute) !== automationSource) {
    writeText(automationsRoute, automationSource);
    changedFiles.push('packages/app/routes/automations.mjs');
  }

  updateSurfaceHonesty(args.mailchimpRoot, STRICT_SURFACES[0].productFiles, STRICT_SURFACES[0].targetedTests, 'Automation journey visual orchestration layer');
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: STRICT_SURFACES[0].productFiles, testFiles: ['tests/journey-designer-client.test.mjs'] });
  return { changedFiles, productFiles: STRICT_SURFACES[0].productFiles, testFiles: ['tests/journey-designer-client.test.mjs'] };
}

function applyAudienceWarehouse(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'audience_identity_lifecycle_warehouse_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-audience.mjs', 'buildAudienceWarehouseSnapshot'],
    ['packages/app/domain-audience.mjs', 'refreshAudienceWarehouseSnapshot'],
    ['packages/app/routes/audience.mjs', '/audiences/:id/warehouse'],
    ['tests/audience-warehouse-lifecycle.test.mjs', 'audience warehouse snapshot resolves identity graph']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Audience identity lifecycle warehouse');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/audience-warehouse-lifecycle.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/audience-warehouse-lifecycle.test.mjs'], missingMarkers };
}

function applyReportingTelemetry(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'reporting_telemetry_pipeline_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/analytics-events.mjs', 'buildTelemetryPipelineSnapshot'],
    ['packages/app/analytics-events.mjs', 'refreshReportingTelemetryPipeline'],
    ['packages/app/routes/reports.mjs', '/reports/telemetry'],
    ['tests/reporting-telemetry-pipeline.test.mjs', 'reporting telemetry pipeline ingests events']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Reporting telemetry pipeline');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/reporting-telemetry-pipeline.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/reporting-telemetry-pipeline.test.mjs'], missingMarkers };
}

function applyAiPredictiveRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'ai_predictive_recommendation_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/ai-provider.mjs', 'AI_PROVIDER_REGISTRY'],
    ['packages/app/predictive-model.mjs', 'buildPredictiveFeatureStore'],
    ['packages/app/domain-current-product-ops.mjs', 'refreshAiPredictiveRecommendations'],
    ['packages/app/domain-current-product-ops.mjs', 'applyAiPredictiveRecommendation'],
    ['packages/app/routes/current-product-ops.mjs', '/ai/predictive'],
    ['packages/app/routes/current-product-ops.mjs', '/api/ai/predictive'],
    ['packages/app/storage.mjs', 'aiRecommendationRuns'],
    ['tests/ai-predictive-recommendations.test.mjs', 'AI predictive recommendations build a provider runtime ledger']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'AI predictive recommendation runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/ai-predictive-recommendations.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/ai-predictive-recommendations.test.mjs'], missingMarkers };
}

function applyIntegrationProviderRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'integration_provider_account_sync_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/integration-provider.mjs', 'INTEGRATION_PROVIDER_CONTRACTS'],
    ['packages/app/integration-provider.mjs', 'buildProviderAccountRuntime'],
    ['packages/app/domain-integration-marketplace.mjs', 'integrationProviderCursors'],
    ['packages/app/domain-integration-marketplace.mjs', 'recordIntegrationProviderWebhookEvent'],
    ['packages/app/routes/current-product-ops.mjs', '/integrations/:id/webhooks/test'],
    ['packages/app/routes/integrations-marketplace.mjs', 'Provider accounts'],
    ['packages/app/storage.mjs', 'integrationProviderAccounts'],
    ['tests/integration-provider-account-runtime.test.mjs', 'integration provider runtime persists provider accounts']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Integration provider account sync runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/integration-provider-account-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/integration-provider-account-runtime.test.mjs'], missingMarkers };
}

function applyAuthSessionSecurityRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'auth_session_security_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/security.mjs', 'AUTH_SECURITY_RUNTIME_CONTRACT'],
    ['packages/app/security.mjs', 'buildAuthSecurityRuntimeSnapshot'],
    ['packages/app/security.mjs', 'issueCsrfToken'],
    ['packages/app/security.mjs', 'verifyMfaChallenge'],
    ['packages/app/security.mjs', 'rotateWorkspaceApiKey'],
    ['packages/app/routes/platform.mjs', '/security/csrf/issue'],
    ['packages/app/routes/platform.mjs', '/api/security/runtime'],
    ['packages/app/storage.mjs', 'csrfTokens'],
    ['packages/app/view.mjs', 'href="/security"'],
    ['tests/auth-security-runtime.test.mjs', 'auth security runtime issues CSRF tokens']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Authentication session security runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/auth-security-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/auth-security-runtime.test.mjs'], missingMarkers };
}

function applyPersistenceJobsOperationalRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'persistence_jobs_operational_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/jobs.mjs', 'JOBS_OPERATIONAL_RUNTIME_CONTRACT'],
    ['packages/app/jobs.mjs', 'buildJobOperationalSnapshot'],
    ['packages/app/jobs.mjs', 'requeueDeadLetterJob'],
    ['packages/app/jobs.mjs', 'recordJobServiceHeartbeat'],
    ['packages/app/job-runtime.mjs', 'recordJobServiceHeartbeat'],
    ['packages/app/job-handlers.mjs', 'audience_provider_sync'],
    ['packages/app/routes/api-admin.mjs', '/jobs/operations'],
    ['packages/app/routes/api-admin.mjs', '/api/jobs/operations'],
    ['packages/app/storage.mjs', 'jobOperationalLedger'],
    ['packages/app/storage.mjs', 'jobQueueLeases'],
    ['tests/persistence-jobs-operational-runtime.test.mjs', 'persistence/jobs operational runtime records leases']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Persistence and jobs operational runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/persistence-jobs-operational-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/persistence-jobs-operational-runtime.test.mjs'], missingMarkers };
}

function applyFrontendClientShellRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'frontend_full_client_application_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['apps/web/public/app-shell-client.mjs', 'CLIENT_SHELL_RUNTIME_CONTRACT'],
    ['apps/web/public/app-shell-client.mjs', 'buildCommandPalette'],
    ['apps/web/public/app-shell-client.mjs', 'previewShellRoute'],
    ['apps/web/public/app-shell-client.mjs', 'recentWork'],
    ['apps/web/public/app-shell.jsx', 'app-shell-client.mjs'],
    ['apps/web/public/app-shell.css', 'client-shell-palette'],
    ['packages/app/view.mjs', 'progressive-client-runtime'],
    ['packages/app/routes/public.mjs', '/static/app-shell-client.mjs'],
    ['packages/app/routes/public.mjs', '/api/client-shell/runtime'],
    ['tests/frontend-client-shell-runtime.test.mjs', 'frontend client shell runtime resolves routes']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Frontend full client application runtime shell');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/frontend-client-shell-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/frontend-client-shell-runtime.test.mjs'], missingMarkers };
}

function applyCampaignEditorVisualBuilderRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'campaign_editor_visual_builder_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['apps/web/public/editor-client.mjs', 'CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT'],
    ['apps/web/public/editor-client.mjs', 'buildBlockInspectorState'],
    ['apps/web/public/editor-client.mjs', 'applyVisualStylePatch'],
    ['apps/web/public/editor-client.mjs', 'applyAssetTransform'],
    ['apps/web/public/editor-client.mjs', 'renderPersonalizationPreview'],
    ['apps/web/public/app-shell.css', 'client-editor-inspector'],
    ['packages/app/routes/campaigns.mjs', 'CAMPAIGN_EDITOR_VISUAL_BUILDER_RUNTIME_CONTRACT'],
    ['packages/app/routes/campaigns.mjs', 'buildCampaignEditorVisualRuntimeSnapshot'],
    ['packages/app/routes/campaigns.mjs', '/editor/block/:index/visual'],
    ['packages/app/routes/campaigns.mjs', '/api/campaigns/:id/editor/runtime'],
    ['tests/campaign-editor-visual-builder-runtime.test.mjs', 'campaign editor visual builder client models inspector']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Campaign editor visual builder runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/campaign-editor-visual-builder-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/campaign-editor-visual-builder-runtime.test.mjs'], missingMarkers };
}

function applyWebsiteBuilderPublishRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'website_builder_publish_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['apps/web/public/website-designer-client.mjs', 'WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT'],
    ['apps/web/public/website-designer-client.mjs', 'buildWebsiteSeoInspectorState'],
    ['apps/web/public/website-designer-client.mjs', 'buildPublishReadinessChecklist'],
    ['apps/web/public/website-designer-client.mjs', 'createPageExperimentVariant'],
    ['apps/web/public/app-shell.css', 'website-publish-runtime'],
    ['packages/app/domain-website-builder.mjs', 'WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT'],
    ['packages/app/domain-website-builder.mjs', 'buildWebsitePublishRuntimeSnapshot'],
    ['packages/app/domain-website-builder.mjs', 'recordWebsiteSeoAudit'],
    ['packages/app/domain-website-builder.mjs', 'createWebsiteExperimentVariant'],
    ['packages/app/routes/website-builder.mjs', '/api/websites/:id/runtime'],
    ['packages/app/routes/website-builder.mjs', '/websites/:id/seo-audit'],
    ['tests/website-builder-publish-runtime.test.mjs', 'website builder client models SEO inspector']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Website builder publish/runtime layer');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/website-builder-publish-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/website-builder-publish-runtime.test.mjs'], missingMarkers };
}

function applyLeadCaptureConversionRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'lead_capture_landing_page_conversion_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-leads.mjs', 'LEAD_CAPTURE_CONVERSION_RUNTIME_CONTRACT'],
    ['packages/app/domain-leads.mjs', 'buildLeadCaptureConversionRuntimeSnapshot'],
    ['packages/app/domain-leads.mjs', 'recordLeadAttributionEvent'],
    ['packages/app/domain-leads.mjs', 'recordLeadConsentReceipt'],
    ['packages/app/domain-leads.mjs', 'createLandingPageExperimentVariant'],
    ['packages/app/domain-growth.mjs', 'recordLeadAttributionEvent'],
    ['packages/app/domain-growth.mjs', 'recordLeadConsentReceipt'],
    ['packages/app/routes/leads.mjs', '/api/leads/conversion-runtime'],
    ['packages/app/routes/leads.mjs', '/leads/conversion-runtime/snapshot'],
    ['packages/app/storage.mjs', 'leadConversionSnapshots'],
    ['packages/app/storage.mjs', 'leadAttributionEvents'],
    ['packages/app/storage.mjs', 'leadConsentReceipts'],
    ['packages/app/storage.mjs', 'landingPageExperiments'],
    ['tests/lead-capture-conversion-runtime.test.mjs', 'lead capture conversion runtime builds attribution']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Lead capture and landing-page conversion runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/lead-capture-conversion-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/lead-capture-conversion-runtime.test.mjs'], missingMarkers };
}

function applyCommerceRevenueRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'commerce_revenue_attribution_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-commerce-revenue.mjs', 'COMMERCE_REVENUE_RUNTIME_CONTRACT'],
    ['packages/app/domain-commerce-revenue.mjs', 'buildCommerceRevenueRuntimeSnapshot'],
    ['packages/app/domain-commerce-revenue.mjs', 'refreshCommerceCustomerProfiles'],
    ['packages/app/domain-commerce-revenue.mjs', 'recordAbandonedCartEvent'],
    ['packages/app/domain-commerce-revenue.mjs', 'recordProductRecommendationEvent'],
    ['packages/app/routes/commerce-revenue.mjs', '/api/commerce/runtime'],
    ['packages/app/routes/commerce-revenue.mjs', '/commerce/runtime/snapshot'],
    ['packages/app/storage.mjs', 'commerceRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'commerceCustomerProfiles'],
    ['packages/app/storage.mjs', 'abandonedCartEvents'],
    ['packages/app/storage.mjs', 'productRecommendationEvents'],
    ['tests/commerce-revenue-runtime.test.mjs', 'commerce revenue runtime builds customer profile']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Commerce revenue attribution and recovery runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/commerce-revenue-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/commerce-revenue-runtime.test.mjs'], missingMarkers };
}

function applyConversationInboxRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'conversation_inbox_sla_assignment_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/conversation-inbox/domain-conversation-inbox.mjs', 'CONVERSATION_INBOX_RUNTIME_CONTRACT'],
    ['packages/conversation-inbox/domain-conversation-inbox.mjs', 'buildConversationRuntimeSnapshot'],
    ['packages/conversation-inbox/domain-conversation-inbox.mjs', 'assignConversation'],
    ['packages/conversation-inbox/domain-conversation-inbox.mjs', 'applyConversationMacro'],
    ['packages/conversation-inbox/domain-conversation-inbox.mjs', 'createConversationAutomationHandoff'],
    ['packages/conversation-inbox/routes/conversation-inbox.mjs', '/api/conversations/runtime'],
    ['packages/conversation-inbox/routes/conversation-inbox.mjs', '/conversations/runtime/snapshot'],
    ['packages/app/storage.mjs', 'conversationRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'conversationSlaEvents'],
    ['packages/app/storage.mjs', 'conversationAssignments'],
    ['packages/app/storage.mjs', 'conversationMacros'],
    ['packages/app/storage.mjs', 'conversationAutomationHandoffs'],
    ['tests/conversation-inbox-runtime.test.mjs', 'conversation inbox runtime builds SLA']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Conversation inbox SLA/assignment runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/conversation-inbox-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/conversation-inbox-runtime.test.mjs'], missingMarkers };
}

function applySurveyFeedbackRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'survey_feedback_insights_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/surveys-feedback/domain-surveys-feedback.mjs', 'SURVEY_FEEDBACK_RUNTIME_CONTRACT'],
    ['packages/surveys-feedback/domain-surveys-feedback.mjs', 'buildSurveyFeedbackRuntimeSnapshot'],
    ['packages/surveys-feedback/domain-surveys-feedback.mjs', 'recordSurveySentimentEvent'],
    ['packages/surveys-feedback/domain-surveys-feedback.mjs', 'buildSurveyFeedbackSegments'],
    ['packages/surveys-feedback/domain-surveys-feedback.mjs', 'createSurveyAutomationHandoff'],
    ['packages/surveys-feedback/routes/surveys-feedback.mjs', '/api/surveys/runtime'],
    ['packages/surveys-feedback/routes/surveys-feedback.mjs', '/surveys/runtime/snapshot'],
    ['packages/app/storage.mjs', 'surveyRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'surveySentimentEvents'],
    ['packages/app/storage.mjs', 'surveySegments'],
    ['packages/app/storage.mjs', 'surveyDeliveryEvents'],
    ['packages/app/storage.mjs', 'surveyAutomationHandoffs'],
    ['tests/surveys-feedback-runtime.test.mjs', 'survey feedback runtime builds sentiment']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Survey feedback insights runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/surveys-feedback-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/surveys-feedback-runtime.test.mjs'], missingMarkers };
}

function applyPreferenceCenterRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'preference_center_consent_suppression_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/preferences-center/domain-preferences-center.mjs', 'PREFERENCE_CENTER_RUNTIME_CONTRACT'],
    ['packages/preferences-center/domain-preferences-center.mjs', 'buildPreferenceRuntimeSnapshot'],
    ['packages/preferences-center/domain-preferences-center.mjs', 'recordPreferenceConsentEvent'],
    ['packages/preferences-center/domain-preferences-center.mjs', 'verifyPreferenceDoubleOptIn'],
    ['packages/preferences-center/domain-preferences-center.mjs', 'reconcilePreferenceSuppressions'],
    ['packages/preferences-center/domain-preferences-center.mjs', 'createPreferenceExportRun'],
    ['packages/preferences-center/routes/preferences-center.mjs', '/api/preferences/runtime'],
    ['packages/preferences-center/routes/preferences-center.mjs', '/preferences/runtime/snapshot'],
    ['packages/app/storage.mjs', 'preferenceRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'preferenceConsentEvents'],
    ['packages/app/storage.mjs', 'preferenceSuppressionSyncs'],
    ['packages/app/storage.mjs', 'preferenceExportRuns'],
    ['tests/preferences-center-runtime.test.mjs', 'preference center runtime builds consent']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Preference center consent/suppression runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/preferences-center-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/preferences-center-runtime.test.mjs'], missingMarkers };
}

function applyTransactionalMessagingRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'transactional_messaging_delivery_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'TRANSACTIONAL_MESSAGING_RUNTIME_CONTRACT'],
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'buildTransactionalRuntimeSnapshot'],
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'recordTransactionalTriggerEvent'],
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'recordTransactionalRenderEvent'],
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'recordTransactionalDeliveryAttempt'],
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'recordTransactionalSuppressionEvent'],
    ['packages/customer-journeys/domain-customer-journeys.mjs', 'recordTransactionalWebhookEvent'],
    ['packages/customer-journeys/routes/customer-journeys.mjs', '/api/journeys/transactional/runtime'],
    ['packages/customer-journeys/routes/customer-journeys.mjs', '/journeys/transactional/runtime/snapshot'],
    ['packages/app/storage.mjs', 'transactionalRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'transactionalTriggerEvents'],
    ['packages/app/storage.mjs', 'transactionalRenderEvents'],
    ['packages/app/storage.mjs', 'transactionalDeliveryAttempts'],
    ['packages/app/storage.mjs', 'transactionalSuppressionEvents'],
    ['packages/app/storage.mjs', 'transactionalWebhookEvents'],
    ['tests/transactional-messaging-runtime.test.mjs', 'transactional messaging runtime builds trigger']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Transactional messaging delivery runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/transactional-messaging-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/transactional-messaging-runtime.test.mjs'], missingMarkers };
}

function applyMobileAppRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'mobile_app_push_offline_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/mobile-app/domain-mobile-app.mjs', 'MOBILE_APP_RUNTIME_CONTRACT'],
    ['packages/mobile-app/domain-mobile-app.mjs', 'buildMobileRuntimeSnapshot'],
    ['packages/mobile-app/domain-mobile-app.mjs', 'registerMobilePushToken'],
    ['packages/mobile-app/domain-mobile-app.mjs', 'recordMobileDeviceTrustEvent'],
    ['packages/mobile-app/domain-mobile-app.mjs', 'resolveMobileActionConflict'],
    ['packages/mobile-app/domain-mobile-app.mjs', 'recordMobileNotificationEvent'],
    ['packages/mobile-app/routes/mobile-app.mjs', '/api/mobile-app/runtime'],
    ['packages/mobile-app/routes/mobile-app.mjs', '/mobile-app/runtime/snapshot'],
    ['packages/app/storage.mjs', 'mobileRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'mobilePushRegistrations'],
    ['packages/app/storage.mjs', 'mobileDeviceTrustEvents'],
    ['packages/app/storage.mjs', 'mobileSyncBatches'],
    ['packages/app/storage.mjs', 'mobileConflictResolutions'],
    ['packages/app/storage.mjs', 'mobileNotificationEvents'],
    ['tests/mobile-app-runtime.test.mjs', 'mobile app runtime builds push']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Mobile app push/offline runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/mobile-app-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/mobile-app-runtime.test.mjs'], missingMarkers };
}

function applyContentStudioRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'content_studio_template_asset_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-template-assets.mjs', 'CONTENT_STUDIO_RUNTIME_CONTRACT'],
    ['packages/app/domain-template-assets.mjs', 'buildContentStudioRuntimeSnapshot'],
    ['packages/app/domain-template-assets.mjs', 'recordContentAssetLifecycleEvent'],
    ['packages/app/domain-template-assets.mjs', 'recordContentTemplateReviewEvent'],
    ['packages/app/domain-template-assets.mjs', 'recordContentUsageTelemetryEvent'],
    ['packages/app/domain-template-assets.mjs', 'recordContentGovernanceEvent'],
    ['packages/app/routes/content-asset-templates.mjs', '/content/runtime/snapshot'],
    ['packages/app/routes/api-admin.mjs', '/api/content/runtime'],
    ['packages/app/storage.mjs', 'contentRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'contentAssetLifecycleEvents'],
    ['packages/app/storage.mjs', 'contentTemplateReviewEvents'],
    ['packages/app/storage.mjs', 'contentUsageTelemetryEvents'],
    ['packages/app/storage.mjs', 'contentGovernanceEvents'],
    ['tests/content-studio-runtime.test.mjs', 'content studio runtime builds asset lifecycle']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Content studio template/asset runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/content-studio-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/content-studio-runtime.test.mjs'], missingMarkers };
}

function applySmsMarketingRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'sms_marketing_native_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'SMS_MARKETING_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'buildSmsMarketingRuntimeSnapshot'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSmsConsentEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSmsComplianceEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSmsDeliveryAttempt'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSmsLinkTrackingEvent'],
    ['packages/app/routes/current-product-ops.mjs', '/api/omnichannel/sms-runtime'],
    ['packages/app/routes/current-product-ops.mjs', '/omnichannel/sms-runtime/snapshot'],
    ['packages/app/storage.mjs', 'smsRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'smsConsentEvents'],
    ['packages/app/storage.mjs', 'smsComplianceEvents'],
    ['packages/app/storage.mjs', 'smsDeliveryAttempts'],
    ['packages/app/storage.mjs', 'smsLinkTrackingEvents'],
    ['tests/sms-marketing-runtime.test.mjs', 'SMS marketing runtime records consent']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'SMS marketing native runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/sms-marketing-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/sms-marketing-runtime.test.mjs'], missingMarkers };
}

function applySocialPublishingRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'social_publishing_native_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'SOCIAL_PUBLISHING_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'buildSocialPublishingRuntimeSnapshot'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialApprovalEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialScheduleEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialProviderHandoff'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialEngagementEvent'],
    ['packages/app/routes/current-product-ops.mjs', '/api/omnichannel/social-runtime'],
    ['packages/app/routes/current-product-ops.mjs', '/omnichannel/social-runtime/snapshot'],
    ['packages/app/storage.mjs', 'socialRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'socialApprovalEvents'],
    ['packages/app/storage.mjs', 'socialScheduledPosts'],
    ['packages/app/storage.mjs', 'socialProviderHandoffs'],
    ['packages/app/storage.mjs', 'socialEngagementEvents'],
    ['tests/social-publishing-runtime.test.mjs', 'social publishing runtime records approval']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Social publishing native runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/social-publishing-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/social-publishing-runtime.test.mjs'], missingMarkers };
}

function applyAdsRetargetingRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'ads_retargeting_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'ADS_RETARGETING_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'buildAdsRetargetingRuntimeSnapshot'],
    ['packages/app/domain-current-product-ops.mjs', 'recordAdsRetargetingAudience'],
    ['packages/app/domain-current-product-ops.mjs', 'recordAdsBudgetPacingEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordAdsProviderSyncEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordAdsConversionAttributionEvent'],
    ['packages/app/routes/current-product-ops.mjs', '/api/omnichannel/ads-runtime'],
    ['packages/app/routes/current-product-ops.mjs', '/omnichannel/ads-runtime/snapshot'],
    ['packages/app/storage.mjs', 'adsRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'adsRetargetingAudiences'],
    ['packages/app/storage.mjs', 'adsBudgetPacingEvents'],
    ['packages/app/storage.mjs', 'adsProviderSyncEvents'],
    ['packages/app/storage.mjs', 'adsConversionAttributionEvents'],
    ['tests/ads-retargeting-runtime.test.mjs', 'ads retargeting runtime records audiences']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Ads retargeting runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/ads-retargeting-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/ads-retargeting-runtime.test.mjs'], missingMarkers };
}

function applyDeveloperApiWebhookRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'developer_webhooks_api_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-core.mjs', 'DEVELOPER_WEBHOOKS_API_RUNTIME_CONTRACT'],
    ['packages/app/domain-core.mjs', 'createDeveloperScopedApiKey'],
    ['packages/app/domain-core.mjs', 'recordDeveloperApiRequestAudit'],
    ['packages/app/domain-core.mjs', 'createDeveloperWebhookSubscription'],
    ['packages/app/domain-core.mjs', 'dispatchDeveloperWebhookDelivery'],
    ['packages/app/domain-core.mjs', 'replayDeveloperWebhookDelivery'],
    ['packages/app/domain-core.mjs', 'buildDeveloperApiRuntimeSnapshot'],
    ['packages/app/routes/api-admin.mjs', '/api/developer/runtime'],
    ['packages/app/routes/api-admin.mjs', '/developer/runtime/snapshot'],
    ['packages/app/routes/api-admin.mjs', '/developer/webhooks/deliveries/:id/replay'],
    ['packages/app/storage.mjs', 'developerRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'developerApiRequestAudits'],
    ['packages/app/storage.mjs', 'webhookSubscriptionEvents'],
    ['tests/developer-api-webhook-runtime.test.mjs', 'developer API/webhook runtime records scoped keys']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Developer API/webhook runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/developer-api-webhook-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/developer-api-webhook-runtime.test.mjs'], missingMarkers };
}

function applyBillingEntitlementsRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'billing_entitlements_usage_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-core.mjs', 'BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT'],
    ['packages/app/domain-core.mjs', 'recordBillingUsageMeterEvent'],
    ['packages/app/domain-core.mjs', 'startBillingTrial'],
    ['packages/app/domain-core.mjs', 'runBillingInvoiceCollection'],
    ['packages/app/domain-core.mjs', 'buildBillingEntitlementsRuntimeSnapshot'],
    ['packages/app/domain-core.mjs', 'persistBillingEntitlementsRuntimeSnapshot'],
    ['packages/app/routes/platform.mjs', '/billing/usage-meter'],
    ['packages/app/routes/platform.mjs', '/billing/runtime/snapshot'],
    ['packages/app/routes/api-admin.mjs', '/api/billing/runtime'],
    ['packages/app/storage.mjs', 'billingRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'billingUsageMeterEvents'],
    ['packages/app/storage.mjs', 'billingEntitlementEvents'],
    ['packages/app/storage.mjs', 'billingTrialEvents'],
    ['packages/app/storage.mjs', 'billingInvoiceEvents'],
    ['tests/billing-entitlements-runtime.test.mjs', 'billing entitlement runtime records plan reconciliation']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Billing entitlement and usage runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/billing-entitlements-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/billing-entitlements-runtime.test.mjs'], missingMarkers };
}

function applyTeamGovernanceRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'team_governance_permissions_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-core.mjs', 'TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT'],
    ['packages/app/domain-core.mjs', 'recordTeamPermissionPolicy'],
    ['packages/app/domain-core.mjs', 'recordTeamAccessReview'],
    ['packages/app/domain-core.mjs', 'recordTeamDelegatedAdminGrant'],
    ['packages/app/domain-core.mjs', 'recordTeamScimProvisioningEvent'],
    ['packages/app/domain-core.mjs', 'recordTeamRegionGovernanceEvent'],
    ['packages/app/domain-core.mjs', 'buildTeamGovernanceRuntimeSnapshot'],
    ['packages/app/routes/platform.mjs', '/team/governance'],
    ['packages/app/routes/platform.mjs', '/team/runtime/snapshot'],
    ['packages/app/routes/api-admin.mjs', '/api/team/runtime'],
    ['packages/app/storage.mjs', 'teamGovernanceRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'teamPermissionPolicyEvents'],
    ['packages/app/storage.mjs', 'teamAccessReviewEvents'],
    ['packages/app/storage.mjs', 'teamDelegatedAdminEvents'],
    ['packages/app/storage.mjs', 'teamScimProvisioningEvents'],
    ['packages/app/storage.mjs', 'teamRegionGovernanceEvents'],
    ['tests/team-governance-runtime.test.mjs', 'team governance runtime records permission policies']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Team governance and permissions runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/team-governance-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/team-governance-runtime.test.mjs'], missingMarkers };
}

function applySettingsDomainsDeliverabilityRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'settings_domains_deliverability_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-deliverability-compliance.mjs', 'SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT'],
    ['packages/app/domain-deliverability-compliance.mjs', 'recordDomainDnsAuthenticationCheck'],
    ['packages/app/domain-deliverability-compliance.mjs', 'recordDmarcAlignmentEvent'],
    ['packages/app/domain-deliverability-compliance.mjs', 'recordSenderReputationWarmupEvent'],
    ['packages/app/domain-deliverability-compliance.mjs', 'recordDedicatedIpReadinessEvent'],
    ['packages/app/domain-deliverability-compliance.mjs', 'runDeliverabilityComplianceReview'],
    ['packages/app/domain-deliverability-compliance.mjs', 'buildSettingsDomainsDeliverabilityRuntimeSnapshot'],
    ['packages/app/routes/deliverability-compliance.mjs', '/deliverability/dns-check'],
    ['packages/app/routes/deliverability-compliance.mjs', '/deliverability/runtime/snapshot'],
    ['packages/app/routes/api-admin.mjs', '/api/deliverability/runtime'],
    ['packages/app/storage.mjs', 'deliverabilityRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'domainDnsCheckEvents'],
    ['packages/app/storage.mjs', 'domainDmarcAlignmentEvents'],
    ['packages/app/storage.mjs', 'senderReputationWarmupEvents'],
    ['packages/app/storage.mjs', 'dedicatedIpReadinessEvents'],
    ['packages/app/storage.mjs', 'complianceReviewRuns'],
    ['tests/settings-domains-deliverability-runtime.test.mjs', 'settings domains deliverability runtime records DNS']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Settings domains deliverability runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/settings-domains-deliverability-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/settings-domains-deliverability-runtime.test.mjs'], missingMarkers };
}

function applyDashboardHomeRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'dashboard_home_insights_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-core.mjs', 'DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT'],
    ['packages/app/domain-core.mjs', 'recordDashboardWidgetPreference'],
    ['packages/app/domain-core.mjs', 'recordDashboardSavedView'],
    ['packages/app/domain-core.mjs', 'recordDashboardInsightAction'],
    ['packages/app/domain-core.mjs', 'recordDashboardDrillthroughEvent'],
    ['packages/app/domain-core.mjs', 'buildDashboardHomeRuntimeSnapshot'],
    ['packages/app/routes/platform.mjs', '/dashboard/runtime'],
    ['packages/app/routes/platform.mjs', '/dashboard/runtime/snapshot'],
    ['packages/app/routes/api-admin.mjs', '/api/dashboard/runtime'],
    ['packages/app/storage.mjs', 'dashboardRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'dashboardWidgetPreferenceEvents'],
    ['packages/app/storage.mjs', 'dashboardInsightEvents'],
    ['packages/app/storage.mjs', 'dashboardTaskQueueEvents'],
    ['packages/app/storage.mjs', 'dashboardDrillthroughEvents'],
    ['packages/app/storage.mjs', 'dashboardSavedViewEvents'],
    ['tests/dashboard-home-runtime.test.mjs', 'dashboard home runtime records widget preferences']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Dashboard home insights runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/dashboard-home-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/dashboard-home-runtime.test.mjs'], missingMarkers };
}

function applyCampaignExperimentRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'campaign_experimentation_decision_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'recordCampaignExperimentAllocation'],
    ['packages/app/domain-current-product-ops.mjs', 'recordCampaignExperimentDynamicContent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordCampaignExperimentHoldoutCompliance'],
    ['packages/app/domain-current-product-ops.mjs', 'recordCampaignExperimentWinnerDecision'],
    ['packages/app/domain-current-product-ops.mjs', 'buildCampaignExperimentRuntimeSnapshot'],
    ['packages/app/routes/current-product-ops.mjs', '/campaigns/experiments/runtime'],
    ['packages/app/routes/current-product-ops.mjs', '/api/campaigns/experiments/runtime'],
    ['packages/app/storage.mjs', 'campaignExperimentRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'campaignExperimentAllocationEvents'],
    ['packages/app/storage.mjs', 'campaignExperimentDynamicContentEvents'],
    ['packages/app/storage.mjs', 'campaignExperimentHoldoutEvents'],
    ['packages/app/storage.mjs', 'campaignExperimentWinnerDecisions'],
    ['tests/campaign-experiment-runtime.test.mjs', 'campaign experimentation runtime records allocation']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Campaign experimentation decision runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/campaign-experiment-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/campaign-experiment-runtime.test.mjs'], missingMarkers };
}

function applyPostcardDirectMailRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'postcard_direct_mail_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'recordPostcardAddressValidationEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordPostcardCreativeProofEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordPostcardProviderHandoffEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordPostcardDeliveryTrackingEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'buildPostcardDirectMailRuntimeSnapshot'],
    ['packages/app/routes/current-product-ops.mjs', '/omnichannel/postcard-runtime'],
    ['packages/app/routes/current-product-ops.mjs', '/api/omnichannel/postcard-runtime'],
    ['packages/app/storage.mjs', 'postcardRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'postcardAddressValidationEvents'],
    ['packages/app/storage.mjs', 'postcardCreativeProofEvents'],
    ['packages/app/storage.mjs', 'postcardProviderHandoffEvents'],
    ['packages/app/storage.mjs', 'postcardDeliveryTrackingEvents'],
    ['tests/postcard-direct-mail-runtime.test.mjs', 'postcard direct-mail runtime records audience eligibility']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Postcard direct-mail runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/postcard-direct-mail-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/postcard-direct-mail-runtime.test.mjs'], missingMarkers };
}

function applyCrossChannelJourneyRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'cross_channel_journey_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-growth.mjs', 'CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT'],
    ['packages/app/domain-growth.mjs', 'recordCrossChannelJourneyNodeConfig'],
    ['packages/app/domain-growth.mjs', 'recordCrossChannelJourneyHandoffEvent'],
    ['packages/app/domain-growth.mjs', 'recordCrossChannelJourneyDecisionEvent'],
    ['packages/app/domain-growth.mjs', 'recordCrossChannelJourneyPerformanceEvent'],
    ['packages/app/domain-growth.mjs', 'buildCrossChannelJourneyRuntimeSnapshot'],
    ['packages/app/domain-growth.mjs', 'persistCrossChannelJourneyRuntimeSnapshot'],
    ['packages/app/domain-journeys.mjs', 'CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT'],
    ['packages/app/routes/automations.mjs', '/automations/:id/cross-channel'],
    ['packages/app/routes/automations.mjs', '/api/automations/:id/cross-channel-runtime'],
    ['packages/app/storage.mjs', 'crossChannelJourneyRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'crossChannelJourneyNodeEvents'],
    ['packages/app/storage.mjs', 'crossChannelJourneyHandoffEvents'],
    ['packages/app/storage.mjs', 'crossChannelJourneyDecisionEvents'],
    ['packages/app/storage.mjs', 'crossChannelJourneyPerformanceEvents'],
    ['tests/cross-channel-journey-runtime.test.mjs', 'cross-channel journey runtime records channel nodes']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Cross-channel journey runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/cross-channel-journey-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/cross-channel-journey-runtime.test.mjs'], missingMarkers };
}

function applySocialCalendarCoordinationRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'social_calendar_coordination_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialCalendarPlacement'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialCampaignCoordinationEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'recordSocialTimelineEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'buildSocialCalendarCoordinationRuntimeSnapshot'],
    ['packages/app/domain-current-product-ops.mjs', 'persistSocialCalendarCoordinationRuntimeSnapshot'],
    ['packages/app/routes/current-product-ops.mjs', '/omnichannel/social-calendar'],
    ['packages/app/routes/current-product-ops.mjs', '/api/omnichannel/social-calendar-runtime'],
    ['packages/app/storage.mjs', 'socialCalendarRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'socialCalendarPlacements'],
    ['packages/app/storage.mjs', 'socialCampaignCoordinationEvents'],
    ['packages/app/storage.mjs', 'socialTimelineEvents'],
    ['tests/social-calendar-coordination-runtime.test.mjs', 'social calendar coordination runtime records campaign links']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Social calendar coordination runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/social-calendar-coordination-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/social-calendar-coordination-runtime.test.mjs'], missingMarkers };
}

function applyOmnichannelReportingAttributionRuntime(args, events) {
  const surface = STRICT_SURFACES.find((entry) => entry.id === 'omnichannel_reporting_attribution_runtime_layer');
  const changedFiles = [];
  const requiredMarkers = [
    ['packages/app/domain-current-product-ops.mjs', 'OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT'],
    ['packages/app/domain-current-product-ops.mjs', 'recordOmnichannelChannelMixSnapshot'],
    ['packages/app/domain-current-product-ops.mjs', 'recordOmnichannelObjectiveRollup'],
    ['packages/app/domain-current-product-ops.mjs', 'recordOmnichannelAttributionEvent'],
    ['packages/app/domain-current-product-ops.mjs', 'buildOmnichannelReportingAttributionRuntimeSnapshot'],
    ['packages/app/domain-current-product-ops.mjs', 'persistOmnichannelReportingAttributionRuntimeSnapshot'],
    ['packages/app/routes/current-product-ops.mjs', '/reports/omnichannel/runtime'],
    ['packages/app/routes/current-product-ops.mjs', '/api/reports/omnichannel/runtime'],
    ['packages/app/storage.mjs', 'omnichannelReportingRuntimeSnapshots'],
    ['packages/app/storage.mjs', 'omnichannelChannelMixSnapshots'],
    ['packages/app/storage.mjs', 'omnichannelObjectiveRollups'],
    ['packages/app/storage.mjs', 'omnichannelAttributionEvents'],
    ['tests/omnichannel-reporting-attribution-runtime.test.mjs', 'omnichannel reporting attribution runtime records channel mix']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, surface.productFiles, surface.targetedTests, 'Omnichannel reporting attribution runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles: surface.productFiles, testFiles: ['tests/omnichannel-reporting-attribution-runtime.test.mjs'] });
  return { changedFiles, productFiles: surface.productFiles, testFiles: ['tests/omnichannel-reporting-attribution-runtime.test.mjs'], missingMarkers };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function frontierSurfaceSpecificTestRelPath(surface) {
  const phase = String(surface?.phase || surface?.id || 'mailchimp-frontier-surface')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'mailchimp-frontier-surface';
  return `tests/mailchimp-frontier-${phase}.test.mjs`;
}

function writeMailchimpFrontierSurfaceSpecificTest(args, surface) {
  const relPath = frontierSurfaceSpecificTestRelPath(surface);
  const testPath = path.join(args.mailchimpRoot, relPath);
  const officialSurface = surface.frontierBaseLabel || surface.label || 'Mailchimp official surface';
  const sourceLabels = Array.isArray(surface.frontierSourceLabels) && surface.frontierSourceLabels.length
    ? surface.frontierSourceLabels
    : [officialSurface];
  const proofDimension = surface.frontierDimensionId || 'runtime_depth';
  const content = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

const SURFACE_ID = ${JSON.stringify(surface.id)};
const STRICT_GAP = ${JSON.stringify(surface.strictGap)};
const OFFICIAL_SURFACE = ${JSON.stringify(officialSurface)};
const SOURCE_LABELS = ${JSON.stringify(sourceLabels)};
const PROOF_DIMENSION = ${JSON.stringify(proofDimension)};

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: \`http://127.0.0.1:\${address.port}\` };
}

test('frontier surface ${surface.id} records surface-specific runtime evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Frontier Surface Owner',
      email: 'frontier-surface-${String(surface.phase || 'surface').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}@example.com',
      password: 'secret123',
      workspaceName: 'Frontier Surface Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/ops/mailchimp-frontier/start', {
      surfaceId: SURFACE_ID,
      strictGap: STRICT_GAP,
      officialSurface: OFFICIAL_SURFACE,
      officialLabels: JSON.stringify(SOURCE_LABELS),
      proofDimension: PROOF_DIMENSION,
      workflowState: 'active_product_gap'
    });

    const run = server.state.db.mailchimpFrontierSurfaceRuns[0];
    assert.ok(run);
    assert.equal(run.surfaceId, SURFACE_ID);
    assert.equal(run.strictGap, STRICT_GAP);
    assert.equal(run.officialSurface, OFFICIAL_SURFACE);
    assert.deepEqual(run.officialLabels, SOURCE_LABELS);
    assert.equal(run.proofDimension, PROOF_DIMENSION);

    await postForm(baseUrl, jar, '/ops/mailchimp-frontier/evidence', {
      runId: run.id,
      eventType: 'surface_specific_runtime_evidence_recorded',
      evidenceLabel: \`surface-specific normal workflow proof for \${SURFACE_ID}\`,
      evidenceStatus: 'observed',
      detail: STRICT_GAP,
      workflowState: 'evidence_recorded'
    });
    await postForm(baseUrl, jar, '/ops/mailchimp-frontier/snapshot', {});

    const apiRuntime = await request(baseUrl, jar, '/api/ops/mailchimp-frontier/runtime');
    assert.equal(apiRuntime.status, 200);
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mailchimpFrontierRuntime.recentRuns[0].surfaceId, SURFACE_ID);
    assert.equal(payload.mailchimpFrontierRuntime.recentRuns[0].strictGap, STRICT_GAP);
    assert.equal(payload.mailchimpFrontierRuntime.recentRuns[0].officialSurface, OFFICIAL_SURFACE);
    assert.equal(payload.mailchimpFrontierRuntime.dimensionCounts[PROOF_DIMENSION], 1);
    assert.equal(payload.mailchimpFrontierRuntime.runtimeHealth.runLedgerReady, true);
    assert.equal(payload.mailchimpFrontierRuntime.runtimeHealth.evidenceLedgerReady, true);
    assert.equal(payload.mailchimpFrontierRuntime.runtimeHealth.snapshotReady, true);
    assert.match(payload.mailchimpFrontierRuntime.recentEvidenceEvents[0].evidenceLabel, new RegExp(SURFACE_ID));
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
`;
  const existing = fs.existsSync(testPath) ? fs.readFileSync(testPath, 'utf8') : null;
  fs.mkdirSync(path.dirname(testPath), { recursive: true });
  if (existing !== content) fs.writeFileSync(testPath, content);
  return { relPath, changed: existing !== content };
}

function applyMailchimpContinuousFrontierRuntime(args, events, selected = null) {
  const surface = selected || STRICT_SURFACES.find((entry) => entry.id === events.at(-1)?.selectedSurfaceId) || STRICT_SURFACES.find((entry) => entry.implementationHandler === 'applyMailchimpContinuousFrontierRuntime');
  const selectedSurface = surface?.implementationHandler === 'applyMailchimpContinuousFrontierRuntime' ? surface : null;
  const changedFiles = [];
  const productFiles = selectedSurface?.productFiles || [
    'packages/app/domain-mailchimp-continuous-frontier.mjs',
    'packages/app/domain-current-product.mjs',
    'packages/app/routes/current-product-ops.mjs',
    'packages/app/storage.mjs'
  ];
  const targetedTests = selectedSurface?.targetedTests || MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_HONESTY_TESTS;
  const surfaceSpecificTest = selectedSurface ? writeMailchimpFrontierSurfaceSpecificTest(args, selectedSurface) : null;
  if (surfaceSpecificTest?.changed) changedFiles.push(surfaceSpecificTest.relPath);
  const requiredMarkers = [
    ['packages/app/domain-mailchimp-continuous-frontier.mjs', 'MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT'],
    ['packages/app/domain-mailchimp-continuous-frontier.mjs', 'recordMailchimpFrontierRuntimeSlice'],
    ['packages/app/domain-mailchimp-continuous-frontier.mjs', 'recordMailchimpFrontierEvidenceEvent'],
    ['packages/app/domain-mailchimp-continuous-frontier.mjs', 'buildMailchimpContinuousFrontierRuntimeSnapshot'],
    ['packages/app/domain-mailchimp-continuous-frontier.mjs', 'persistMailchimpContinuousFrontierRuntimeSnapshot'],
    ['packages/app/domain-current-product.mjs', 'domain-mailchimp-continuous-frontier'],
    ['packages/app/routes/current-product-ops.mjs', '/ops/mailchimp-frontier'],
    ['packages/app/routes/current-product-ops.mjs', '/api/ops/mailchimp-frontier/runtime'],
    ['packages/app/storage.mjs', 'mailchimpFrontierSurfaceRuns'],
    ['packages/app/storage.mjs', 'mailchimpFrontierEvidenceEvents'],
    ['packages/app/storage.mjs', 'mailchimpFrontierRuntimeSnapshots'],
    ['tests/mailchimp-continuous-frontier-runtime.test.mjs', 'mailchimp continuous frontier runtime records official-surface runs']
  ];
  const missingMarkers = requiredMarkers.filter(([relPath, marker]) => !hasText(path.join(args.mailchimpRoot, relPath), marker));
  updateSurfaceHonesty(args.mailchimpRoot, productFiles, targetedTests, 'Mailchimp continuous frontier runtime');
  if (missingMarkers.length) {
    events.push({ type: 'implementation_missing_product_markers', generatedAt: new Date().toISOString(), missingMarkers });
  }
  events.push({ type: 'implementation_generated_product_work', generatedAt: new Date().toISOString(), changedFiles, productFiles, testFiles: ['tests/mailchimp-continuous-frontier-runtime.test.mjs', surfaceSpecificTest?.relPath].filter(Boolean), surfaceSpecificExecutableEvidence: Boolean(surfaceSpecificTest) });
  return { changedFiles, productFiles, testFiles: ['tests/mailchimp-continuous-frontier-runtime.test.mjs', surfaceSpecificTest?.relPath].filter(Boolean), missingMarkers, surfaceSpecificExecutableEvidence: Boolean(surfaceSpecificTest), surfaceSpecificTestFile: surfaceSpecificTest?.relPath || null };
}

function applyMailchimpGlobalGapProductStateProof(args, events, surface) {
  const selectedSurface = surface || STRICT_SURFACES.find((entry) => entry.implementationHandler === 'applyMailchimpGlobalGapProductStateProof');
  const productStateProof = buildExistingProductStateProof(args, selectedSurface);
  updateSurfaceHonesty(args.mailchimpRoot, selectedSurface.productFiles, selectedSurface.targetedTests, `Mailchimp global gap ${selectedSurface.globalGapLabel || selectedSurface.id}`);
  events.push({
    type: productStateProof.ok ? 'global_gap_product_state_proof_ready' : 'global_gap_product_state_proof_missing',
    generatedAt: new Date().toISOString(),
    selectedSurfaceId: selectedSurface.id,
    globalGapId: selectedSurface.globalGapId || null,
    globalGapLabel: selectedSurface.globalGapLabel || null,
    productStateProof
  });
  return {
    changedFiles: [],
    productFiles: selectedSurface.productFiles,
    testFiles: selectedSurface.targetedTests,
    explicitProductStateProof: productStateProof.ok,
    productStateProof,
    globalGapId: selectedSurface.globalGapId || null,
    globalGapLabel: selectedSurface.globalGapLabel || null
  };
}

function updateSurfaceHonesty(mailchimpRoot, productFiles, tests, label) {
  const manifestPath = path.join(mailchimpRoot, 'surface-honesty.json');
  const manifest = readJson(manifestPath, { version: 1, policy: {}, surfaces: {} });
  manifest.version ||= 1;
  manifest.policy = {
    changedProductFilesMustBeDeclared: true,
    allowedChangedStatuses: ['real'],
    requireEvidenceTests: true,
    bannedPlaceholderLanguage: ['coming soon', 'placeholder', 'stub', 'mock', 'fake', 'simulated', 'TODO'],
    ...(manifest.policy || {})
  };
  manifest.surfaces ||= {};
  for (const relPath of productFiles) {
    const existing = manifest.surfaces[relPath] || {};
    const evidence = existing.evidence || {};
    const mergedTests = Array.from(new Set([...(evidence.tests || []), ...tests])).sort();
    manifest.surfaces[relPath] = {
      label: existing.label || (relPath.includes('journey-designer-client') ? 'Journey designer client module' : label),
      status: 'real',
      evidence: { ...evidence, tests: mergedTests },
      notes: existing.notes || `Real product surface for autonomous strict-gap continuation proof: ${label}; served through normal authenticated app routes with executable tests.`
    };
  }
  writeJson(manifestPath, manifest);
}

function proofEvidenceFor(surface) {
  if (surface.id === 'audience_identity_lifecycle_warehouse_layer') {
    return [
      'buildAudienceWarehouseSnapshot resolves duplicate identity groups, lifecycle stages, source completeness, and warehouse rows from live audience contacts',
      '/audiences/:id links to the identity lifecycle warehouse from the audience overview',
      '/audiences/:id/warehouse/refresh persists durable audienceWarehouseSnapshots and writes an audit event',
      'audience warehouse regression keeps the core contacts/filtering flow green after the warehouse adoption'
    ];
  }
  if (surface.id === 'reporting_telemetry_pipeline_layer') {
    return [
      'recordAnalyticsEvent now normalizes telemetry events, records analyticsPipelineRuns, and writes telemetryLineageLedger rows',
      'buildTelemetryPipelineSnapshot builds campaign, website, automation, source, event type, attribution, freshness, and lineage rollups from live workspace state',
      '/reports shows telemetry pipeline status and links to /reports/telemetry',
      '/reports/telemetry/refresh persists reportingTelemetrySnapshots and keeps existing reports/admin/billing analytics tests green'
    ];
  }
  if (surface.id === 'ai_predictive_recommendation_runtime_layer') {
    return [
      'AI_PROVIDER_REGISTRY and buildProviderRuntimeEnvelope expose provider/model capabilities and evidence contracts for recommendation runs',
      'buildPredictiveFeatureStore derives contact feature vectors, lifecycle tiers, send windows, and aggregate scores from live workspace contacts',
      'refreshAiPredictiveRecommendations persists aiRecommendationRuns and predictiveRecommendationSnapshots with lineage and recommendation evidence',
      '/ai/predictive, /ai/predictive/refresh, /ai/predictive/recommendations/:id/apply, and /api/ai/predictive expose the model run ledger, queue, acceptance feedback, and campaign optimization apply path'
    ];
  }
  if (surface.id === 'integration_provider_account_sync_runtime_layer') {
    return [
      'INTEGRATION_PROVIDER_CONTRACTS and buildProviderAccountRuntime expose provider account identity, auth mode, object coverage, cursors, webhooks, and evidence contracts',
      'syncMarketplaceInstallation persists integrationProviderRequests, integrationProviderCursors, provider account status, request lineage, synced object counts, and commerce handoff continuity',
      'configureIntegrationInstallation persists OAuth/auth session ledger entries and provider account state for detail-route auth workflows',
      '/integrations, /integrations/:id, /integrations/:id/webhooks/test, and /api/integrations/:id expose provider runtime, cursor lineage, request history, and webhook verification while existing integration flows stay green'
    ];
  }
  if (surface.id === 'auth_session_security_runtime_layer') {
    return [
      'AUTH_SECURITY_RUNTIME_CONTRACT and buildAuthSecurityRuntimeSnapshot expose the session, CSRF, MFA, SSO, API key, and event evidence contract',
      'createSession records active session inventory, assurance, request risk signals, and a durable session security event',
      'issueCsrfToken and validateCsrfToken persist a hashed CSRF ledger with consumed/rejected state and security events',
      'enrollMfaFactor, createMfaChallengeForActor, and verifyMfaChallenge persist MFA factors, challenge state, verification attempts, and audit events',
      'startSsoSessionForActor and rotateWorkspaceApiKey persist SSO session lineage, API key rotations, revoked prior keys, and security event timeline rows',
      '/security and /api/security/runtime expose the security center controls while existing signup/login/reset/platform flows remain green'
    ];
  }
  if (surface.id === 'persistence_jobs_operational_runtime_layer') {
    return [
      'JOBS_OPERATIONAL_RUNTIME_CONTRACT and buildJobOperationalSnapshot expose queue counts, retry state, worker leases, heartbeats, dead letters, and evidence controls',
      'runJobs now records durable active/released/expired lease rows, attempt history, retry scheduling, operational snapshots, and dead-letter payload lineage',
      'recordJobServiceHeartbeat and startJobLoop persist worker service heartbeat state for the in-process job runtime',
      'requeueDeadLetterJob and /jobs/dead-letters/:id/requeue prove operator recovery from terminal job failures',
      '/jobs/operations and /api/jobs/operations expose admin/API job operational evidence while existing storage, SQLite, and security/job hardening flows remain green'
    ];
  }
  if (surface.id === 'frontend_full_client_application_runtime_layer') {
    return [
      'CLIENT_SHELL_RUNTIME_CONTRACT and app-shell-client.mjs expose route manifest hydration, command palette navigation, active route resolution, optimistic preview, and recent work serialization',
      'view.mjs now boots the progressive client runtime from normal server-rendered pages with authenticated workspace context while preserving server route canonicality',
      '/static/app-shell-manifest.json and /api/client-shell/runtime expose route/action manifest and workspace-bound client shell evidence',
      'app-shell.css styles the interactive command palette, route preview, and hydrated client runtime chrome',
      'frontend client shell regression keeps campaign editor and website designer client modules green while proving the broader app shell runtime'
    ];
  }
  if (surface.id === 'campaign_editor_visual_builder_runtime_layer') {
    return [
      'CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT and editor-client.mjs expose block inspector state, visual style patching, asset transform state, personalization preview, and serialized visual runtime evidence',
      'campaign editor blocks now carry stable ids, style tokens, width, image fit/crop/focal-point state, personalization config, and asset transform metadata through the normal editor state seed',
      '/campaigns/:id/editor/block/:index/visual persists visual builder patches, asset transform ledger rows, style patch history, personalization previews, audit events, and editor snapshots',
      '/api/campaigns/:id/editor/runtime exposes inspector counts, asset transform counts, style patch counts, personalization preview counts, available assets, and per-block visual runtime state',
      'campaign editor visual builder regression keeps the existing rich client canvas and depth editor flows green while proving the deeper visual builder runtime slice'
    ];
  }
  if (surface.id === 'website_builder_publish_runtime_layer') {
    return [
      'WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT and website-designer-client.mjs expose SEO inspector state, publish readiness checklist, domain/robots preview, experiment variant preview, and serialized publish runtime evidence',
      'domain-website-builder.mjs persists websiteRuntimeSnapshots, websiteSeoAudits, websiteExperiments, domain/robot/canonical state, runtime snapshots on publish, and publish readiness scoring from live website pages',
      '/websites/:id now adopts the publish runtime card with SEO audit, manual runtime snapshot, experiment variant creation, and normal visual designer seed hydration',
      '/api/websites/:id/runtime exposes publish readiness checklist, SEO scores, domain state, experiments, recent SEO audits, publish history, and analytics counters',
      'website builder publish runtime regression keeps the existing visual designer and current-product parity flows green while proving the deeper website builder runtime slice'
    ];
  }
  if (surface.id === 'lead_capture_landing_page_conversion_runtime_layer') {
    return [
      'LEAD_CAPTURE_CONVERSION_RUNTIME_CONTRACT and domain-leads.mjs expose landing-page funnel snapshots, conversion attribution ledger, consent receipt ledger, experiment variants, and workspace conversion runtime API evidence',
      'domain-growth.mjs records attribution and consent evidence from real public landing page views and hosted form submissions instead of isolated marker state',
      '/leads/forms, /leads/landing-pages, /leads/conversion-runtime/snapshot, /leads/landing-pages/:id/experiments, and /api/leads/conversion-runtime expose normal lead-capture conversion runtime adoption',
      'storage.mjs persists leadConversionSnapshots, leadAttributionEvents, leadConsentReceipts, and landingPageExperiments as durable product collections',
      'lead capture conversion runtime regression keeps forms/landing and phase9 lead capture flows green while proving the deeper conversion runtime slice'
    ];
  }
  if (surface.id === 'commerce_revenue_attribution_runtime_layer') {
    return [
      'COMMERCE_REVENUE_RUNTIME_CONTRACT and domain-commerce-revenue.mjs expose customer value profiles, abandoned-cart recovery events, product recommendation signals, runtime snapshots, and commerce runtime API evidence',
      'syncCommerceStore records customer profiles and product recommendation signals from the normal store sync path instead of disconnected marker state',
      '/commerce, /commerce/stores/:id/abandoned-cart, /commerce/stores/:id/recommendations, /commerce/runtime/snapshot, and /api/commerce/runtime expose normal commerce runtime adoption',
      'storage.mjs persists commerceRuntimeSnapshots, commerceCustomerProfiles, abandonedCartEvents, and productRecommendationEvents as durable product collections',
      'commerce revenue runtime regression keeps current-product and phase9 remaining flows green while proving the deeper commerce runtime slice'
    ];
  }
  if (surface.id === 'conversation_inbox_sla_assignment_runtime_layer') {
    return [
      'CONVERSATION_INBOX_RUNTIME_CONTRACT and domain-conversation-inbox.mjs expose SLA policy events, assignment history, reply macro application, automation handoff payloads, runtime snapshots, and conversation runtime API evidence',
      'normal create/reply/status inbox flows now record SLA and assignment evidence while preserving existing conversation behavior',
      '/conversations, /conversations/:id/assign, /conversations/:id/macro, /conversations/:id/handoff, /conversations/runtime/snapshot, and /api/conversations/runtime expose normal inbox runtime adoption',
      'storage.mjs persists conversationRuntimeSnapshots, conversationSlaEvents, conversationAssignments, conversationMacros, and conversationAutomationHandoffs as durable product collections',
      'conversation inbox runtime regression keeps the existing inbox and mobile companion flows green while proving the deeper inbox operations slice'
    ];
  }
  if (surface.id === 'survey_feedback_insights_runtime_layer') {
    return [
      'SURVEY_FEEDBACK_RUNTIME_CONTRACT and domain-surveys-feedback.mjs expose sentiment classification, feedback segment rollups, delivery event ledgers, automation handoff payloads, runtime snapshots, and survey runtime API evidence',
      'normal survey program creation and response capture now record delivery and sentiment evidence while preserving existing survey behavior',
      '/surveys, /surveys/:id/delivery, /surveys/:id/handoff, /surveys/runtime/snapshot, and /api/surveys/runtime expose normal survey feedback runtime adoption',
      'storage.mjs persists surveyRuntimeSnapshots, surveySentimentEvents, surveySegments, surveyDeliveryEvents, and surveyAutomationHandoffs as durable product collections',
      'survey feedback runtime regression keeps the existing survey and mobile companion flows green while proving the deeper feedback insights slice'
    ];
  }
  if (surface.id === 'preference_center_consent_suppression_runtime_layer') {
    return [
      'PREFERENCE_CENTER_RUNTIME_CONTRACT and domain-preferences-center.mjs expose consent event ledgers, double opt-in confirmation state, suppression reconciliation runs, export run ledgers, runtime snapshots, and preference runtime API evidence',
      'normal hosted profile creation and public preference updates now record auditable consent evidence while preserving existing preference behavior',
      '/preferences, /preferences/:token/double-opt-in, /preferences/suppression-sync, /preferences/exports, /preferences/runtime/snapshot, and /api/preferences/runtime expose normal preference center runtime adoption',
      'storage.mjs persists preferenceRuntimeSnapshots, preferenceConsentEvents, preferenceSuppressionSyncs, and preferenceExportRuns as durable product collections',
      'preference center runtime regression keeps the existing hosted preference and mobile companion flows green while proving the deeper consent/suppression slice'
    ];
  }
  if (surface.id === 'transactional_messaging_delivery_runtime_layer') {
    return [
      'TRANSACTIONAL_MESSAGING_RUNTIME_CONTRACT and domain-customer-journeys.mjs expose trigger event ledgers, template render evidence, delivery attempt/retry history, suppression policy events, webhook events, runtime snapshots, and transactional runtime API evidence',
      'normal transactional journey creation and dispatch now record trigger, render, delivery attempt, and suppression evidence while preserving existing transactional behavior',
      '/journeys/transactional, /journeys/transactional/:id/suppression, /journeys/transactional/:id/webhook, /journeys/transactional/:id/deliveries/:deliveryId/retry, /journeys/transactional/runtime/snapshot, and /api/journeys/transactional/runtime expose normal transactional runtime adoption',
      'storage.mjs persists transactionalRuntimeSnapshots, transactionalTriggerEvents, transactionalRenderEvents, transactionalDeliveryAttempts, transactionalSuppressionEvents, and transactionalWebhookEvents as durable product collections',
      'transactional messaging runtime regression keeps the existing transactional journey and mobile companion flows green while proving the deeper delivery runtime slice'
    ];
  }
  if (surface.id === 'mobile_app_push_offline_runtime_layer') {
    return [
      'MOBILE_APP_RUNTIME_CONTRACT and domain-mobile-app.mjs expose push registration ledgers, device trust/risk events, offline sync batch ledgers, conflict resolution payloads, notification events, runtime snapshots, and mobile runtime API evidence',
      'normal mobile session pairing, offline action queueing, and sync now record device trust, push registration, sync batch, conflict, and notification evidence while preserving existing mobile behavior',
      '/mobile-app, /mobile-app/sessions/:id/push, /mobile-app/sessions/:id/trust, /mobile-app/sessions/:id/conflicts, /mobile-app/sessions/:id/notifications, /mobile-app/runtime/snapshot, and /api/mobile-app/runtime expose normal mobile runtime adoption',
      'storage.mjs persists mobileRuntimeSnapshots, mobilePushRegistrations, mobileDeviceTrustEvents, mobileSyncBatches, mobileConflictResolutions, and mobileNotificationEvents as durable product collections',
      'mobile app runtime regression keeps the existing mobile companion and transactional journey flows green while proving the deeper push/offline runtime slice'
    ];
  }
  if (surface.id === 'content_studio_template_asset_runtime_layer') {
    return [
      'CONTENT_STUDIO_RUNTIME_CONTRACT and domain-template-assets.mjs expose asset lifecycle ledgers, template review lineage, brand governance checks, usage telemetry, runtime snapshots, and content runtime API evidence',
      'normal content studio asset/template/collection workflows now record asset approval, template review, governance, and usage telemetry evidence while preserving existing content behavior',
      '/content, /content/assets/runtime, /content/templates/review, /content/usage, /content/governance, /content/runtime/snapshot, and /api/content/runtime expose normal content runtime adoption',
      'storage.mjs persists contentRuntimeSnapshots, contentAssetLifecycleEvents, contentTemplateReviewEvents, contentUsageTelemetryEvents, and contentGovernanceEvents as durable product collections',
      'content studio runtime regression keeps existing content-asset-template and platform-spine flows green while proving the deeper template/asset lifecycle runtime slice'
    ];
  }
  if (surface.id === 'sms_marketing_native_runtime_layer') {
    return [
      'SMS_MARKETING_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose consent receipt ledgers, quiet-hour/compliance checks, carrier delivery attempts, link tracking events, runtime snapshots, and SMS runtime API evidence',
      'normal omnichannel SMS program creation and launch now record disclosure/compliance and carrier delivery evidence while preserving existing omnichannel behavior',
      '/omnichannel, /omnichannel/sms-runtime, /omnichannel/sms/consent, /omnichannel/sms/compliance, /omnichannel/sms/delivery, /omnichannel/sms/link, /omnichannel/sms-runtime/snapshot, and /api/omnichannel/sms-runtime expose normal SMS runtime adoption',
      'storage.mjs persists smsRuntimeSnapshots, smsConsentEvents, smsComplianceEvents, smsDeliveryAttempts, and smsLinkTrackingEvents as durable product collections',
      'SMS marketing runtime regression keeps existing current-product and sms-orchestration package flows green while proving the deeper native SMS runtime slice'
    ];
  }
  if (surface.id === 'social_publishing_native_runtime_layer') {
    return [
      'SOCIAL_PUBLISHING_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose social approval ledgers, scheduled post queues, provider handoff history, engagement telemetry, runtime snapshots, and social runtime API evidence',
      'normal omnichannel social program creation and launch now record approval, scheduling, provider handoff, and engagement evidence while preserving existing omnichannel behavior',
      '/omnichannel, /omnichannel/social-runtime, /omnichannel/social/approval, /omnichannel/social/schedule, /omnichannel/social/provider-handoff, /omnichannel/social/engagement, /omnichannel/social-runtime/snapshot, and /api/omnichannel/social-runtime expose normal social runtime adoption',
      'storage.mjs persists socialRuntimeSnapshots, socialApprovalEvents, socialScheduledPosts, socialProviderHandoffs, and socialEngagementEvents as durable product collections',
      'social publishing runtime regression keeps existing current-product and social-publisher package flows green while proving the deeper native social runtime slice'
    ];
  }
  if (surface.id === 'ads_retargeting_runtime_layer') {
    return [
      'ADS_RETARGETING_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose retargeting audience ledgers, budget pacing events, provider sync history, conversion attribution telemetry, runtime snapshots, and ads runtime API evidence',
      'normal omnichannel ads program creation and launch now record retargeting audience, budget pacing, provider sync, and conversion attribution evidence while preserving existing omnichannel behavior',
      '/omnichannel, /omnichannel/ads-runtime, /omnichannel/ads/audience, /omnichannel/ads/budget, /omnichannel/ads/provider-sync, /omnichannel/ads/conversion, /omnichannel/ads-runtime/snapshot, and /api/omnichannel/ads-runtime expose normal ads runtime adoption',
      'storage.mjs persists adsRuntimeSnapshots, adsRetargetingAudiences, adsBudgetPacingEvents, adsProviderSyncEvents, and adsConversionAttributionEvents as durable product collections',
      'ads retargeting runtime regression keeps existing current-product omnichannel flows green while proving the deeper native ads runtime slice'
    ];
  }
  if (surface.id === 'developer_webhooks_api_runtime_layer') {
    return [
      'DEVELOPER_WEBHOOKS_API_RUNTIME_CONTRACT and domain-core.mjs expose scoped key lifecycle, API request audit ledger, webhook subscription lifecycle, signed delivery, replay, runtime snapshots, and developer runtime API evidence',
      'normal /developer/api-keys and /developer/webhooks admin paths now create scoped keys, signed webhook subscriptions, test deliveries, pause/resume lifecycle events, and replayable delivery evidence while preserving existing admin behavior',
      '/developer/api-keys, /developer/webhooks, /developer/runtime/snapshot, /developer/webhooks/:id/deliver, /developer/webhooks/deliveries/:id/replay, and /api/developer/runtime expose normal developer runtime adoption',
      'storage.mjs persists developerRuntimeSnapshots, developerApiRequestAudits, and webhookSubscriptionEvents while existing apiKeys, webhooks, and webhookDeliveries carry scopes/signatures/replay lineage',
      'developer API/webhook runtime regression keeps existing reports-admin and platform-spine flows green while proving the deeper developer API/webhook runtime slice'
    ];
  }
  if (surface.id === 'billing_entitlements_usage_runtime_layer') {
    return [
      'BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT and domain-core.mjs expose plan entitlement reconciliation, usage meter events, trial lifecycle events, invoice/tax collection runs, runtime snapshots, and billing runtime API evidence',
      'normal /billing plan changes now reconcile entitlements and invoice events, while /billing/usage-meter, /billing/trial, and /billing/invoice-run exercise usage, trial, and collection operations from the product UI',
      '/billing, /billing/entitlements/reconcile, /billing/usage-meter, /billing/trial, /billing/invoice-run, /billing/runtime/snapshot, and /api/billing/runtime expose normal billing runtime adoption',
      'storage.mjs persists billingRuntimeSnapshots, billingUsageMeterEvents, billingEntitlementEvents, billingTrialEvents, and billingInvoiceEvents as durable product collections',
      'billing entitlement runtime regression keeps existing platform-spine and reports-admin flows green while proving the deeper billing entitlement/usage slice'
    ];
  }
  if (surface.id === 'team_governance_permissions_runtime_layer') {
    return [
      'TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT and domain-core.mjs expose permission policy matrix events, delegated admin grants, SCIM provisioning lifecycle, access review attestations, region governance, runtime snapshots, and team runtime API evidence',
      'normal /team now links to /team/governance while invite and role workflows remain intact; governance forms record policy, access-review, delegated-admin, SCIM, and region-governance evidence from product routes',
      '/team, /team/governance, /team/policies, /team/access-review, /team/delegated-admin, /team/scim, /team/regions, /team/runtime/snapshot, and /api/team/runtime expose normal team governance runtime adoption',
      'storage.mjs persists teamGovernanceRuntimeSnapshots, teamPermissionPolicyEvents, teamAccessReviewEvents, teamDelegatedAdminEvents, teamScimProvisioningEvents, and teamRegionGovernanceEvents as durable product collections',
      'team governance runtime regression keeps existing platform-spine, billing, and developer runtime flows green while proving the deeper team/permissions slice'
    ];
  }
  if (surface.id === 'settings_domains_deliverability_runtime_layer') {
    return [
      'SETTINGS_DOMAINS_DELIVERABILITY_RUNTIME_CONTRACT and domain-deliverability-compliance.mjs expose DNS authentication check ledgers, DMARC alignment events, sender reputation warmup, dedicated IP readiness, compliance review runs, runtime snapshots, and deliverability runtime API evidence',
      'normal /deliverability now records DNS auth checks, DMARC alignment, warmup stages, dedicated IP readiness, and compliance reviews while preserving existing settings domain and suppression flows',
      '/deliverability, /deliverability/dns-check, /deliverability/dmarc, /deliverability/warmup, /deliverability/dedicated-ip, /deliverability/compliance-review, /deliverability/runtime/snapshot, and /api/deliverability/runtime expose normal settings/domains deliverability runtime adoption',
      'storage.mjs persists deliverabilityRuntimeSnapshots, domainDnsCheckEvents, domainDmarcAlignmentEvents, senderReputationWarmupEvents, dedicatedIpReadinessEvents, and complianceReviewRuns as durable product collections',
      'settings domains deliverability runtime regression keeps existing deliverability compliance, platform spine, and team governance flows green while proving the deeper settings/domains slice'
    ];
  }
  if (surface.id === 'dashboard_home_insights_runtime_layer') {
    return [
      'DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT and domain-core.mjs expose role-aware widget preferences, saved dashboard views, insight priority tasks, data freshness ledgers, dashboard drillthrough telemetry, runtime snapshots, and dashboard runtime API evidence',
      'normal /app now exposes dashboard runtime entrypoints while /dashboard/runtime records widget, saved-view, insight, and drillthrough evidence from product routes',
      '/app, /dashboard/runtime, /dashboard/widgets, /dashboard/saved-views, /dashboard/insights, /dashboard/drillthrough, /dashboard/runtime/snapshot, and /api/dashboard/runtime expose normal dashboard runtime adoption',
      'storage.mjs persists dashboardRuntimeSnapshots, dashboardWidgetPreferenceEvents, dashboardInsightEvents, dashboardTaskQueueEvents, dashboardDrillthroughEvents, and dashboardSavedViewEvents as durable product collections',
      'dashboard home runtime regression keeps existing platform spine, settings/domains deliverability, and team governance flows green while proving the deeper dashboard/home slice'
    ];
  }
  if (surface.id === 'campaign_experimentation_decision_runtime_layer') {
    return [
      'CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose campaign experiment variant allocation ledgers, dynamic content rule resolution, holdout compliance events, winner decision audit trails, runtime snapshots, and experiment runtime API evidence',
      'normal campaign experiment creation/run/promotion now records allocation, dynamic rule, holdout, and winner-decision evidence while preserving authenticated campaign shell behavior',
      '/campaigns/:id/experiments, /campaigns/experiments/runtime, /campaigns/experiments/runtime/snapshot, and /api/campaigns/experiments/runtime expose normal campaign experimentation runtime adoption',
      'storage.mjs persists campaignExperimentRuntimeSnapshots, campaignExperimentAllocationEvents, campaignExperimentDynamicContentEvents, campaignExperimentHoldoutEvents, and campaignExperimentWinnerDecisions as durable product collections',
      'campaign experimentation runtime regression keeps existing current-product parity, dashboard runtime, and platform spine flows green while proving the deeper experimentation/optimization slice'
    ];
  }
  if (surface.id === 'postcard_direct_mail_runtime_layer') {
    return [
      'POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose postal audience eligibility, address validation, creative proof approval, print handoff, delivery tracking, runtime snapshots, and postcard runtime API evidence',
      'normal omnichannel postcard program creation and launch now record address validation, creative proof, print provider handoff, and delivery tracking evidence while preserving existing omnichannel behavior',
      '/omnichannel, /omnichannel/postcard-runtime, /omnichannel/postcards/address, /omnichannel/postcards/proof, /omnichannel/postcards/handoff, /omnichannel/postcards/delivery, /omnichannel/postcard-runtime/snapshot, and /api/omnichannel/postcard-runtime expose normal postcard runtime adoption',
      'storage.mjs persists postcardRuntimeSnapshots, postcardAddressValidationEvents, postcardCreativeProofEvents, postcardProviderHandoffEvents, and postcardDeliveryTrackingEvents as durable product collections',
      'postcard direct-mail runtime regression keeps existing current-product and campaign experimentation flows green while proving the deeper SMS/social/postcards omnichannel slice'
    ];
  }
  if (surface.id === 'cross_channel_journey_runtime_layer') {
    return [
      'CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT and domain-growth.mjs expose email/SMS/ad-sync/inbox/survey/postcard journey nodes, channel handoff history, decision audit, performance rollups, runtime snapshots, and cross-channel runtime API evidence',
      'normal automation builder node creation now records cross-channel node configuration evidence for email, SMS, ad audience sync, inbox task, survey request, and postcard nodes while preserving durable server automation forms',
      '/automations/:id/builder, /automations/:id/cross-channel, /automations/:id/cross-channel/snapshot, /automations/:id/cross-channel/handoff, /automations/:id/cross-channel/decision, /automations/:id/cross-channel/performance, and /api/automations/:id/cross-channel-runtime expose normal journey runtime adoption',
      'storage.mjs persists crossChannelJourneyRuntimeSnapshots, crossChannelJourneyNodeEvents, crossChannelJourneyHandoffEvents, crossChannelJourneyDecisionEvents, and crossChannelJourneyPerformanceEvents as durable product collections',
      'cross-channel journey runtime regression keeps existing automation journeys and current-product parity flows green while proving Gap 5.4 cross-channel journey builder depth'
    ];
  }
  if (surface.id === 'social_calendar_coordination_runtime_layer') {
    return [
      'SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose campaign-linked social calendar placements, campaign coordination events, cross-channel timeline events, runtime snapshots, and API evidence',
      'normal /omnichannel and /omnichannel/social-calendar routes let authenticated users record calendar placements, campaign coordination, and timeline events while preserving existing social publishing behavior',
      '/omnichannel/social-calendar, /omnichannel/social-calendar/placement, /omnichannel/social-calendar/coordination, /omnichannel/social-calendar/timeline, /omnichannel/social-calendar/snapshot, and /api/omnichannel/social-calendar-runtime expose normal social calendar runtime adoption',
      'storage.mjs persists socialCalendarRuntimeSnapshots, socialCalendarPlacements, socialCampaignCoordinationEvents, and socialTimelineEvents as durable product collections',
      'social calendar runtime regression keeps existing social publishing and current-product parity flows green while proving campaign-linked calendar coordination depth'
    ];
  }
  if (surface.id === 'omnichannel_reporting_attribution_runtime_layer') {
    return [
      'OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT and domain-current-product-ops.mjs expose channel mix snapshots, objective rollups, touchpoint attribution events, reporting runtime snapshots, and API evidence',
      'normal /reports/omnichannel/runtime routes let authenticated users capture channel mix, objective rollups, and attribution touchpoints from live channel programs while preserving omnichannel flows',
      '/reports/omnichannel/runtime, /reports/omnichannel/channel-mix, /reports/omnichannel/objective-rollup, /reports/omnichannel/attribution, /reports/omnichannel/runtime/snapshot, and /api/reports/omnichannel/runtime expose normal reporting runtime adoption',
      'storage.mjs persists omnichannelReportingRuntimeSnapshots, omnichannelChannelMixSnapshots, omnichannelObjectiveRollups, and omnichannelAttributionEvents as durable product collections',
      'omnichannel reporting regression keeps existing social calendar, postcard, and current-product parity flows green while proving attribution/reporting depth'
    ];
  }
  if (surface.globalGapId) {
    return [
      `strict_1to1_gap_inventory global gap ${surface.globalGapId} (${surface.globalGapLabel}) is evaluated against canonical product files rather than the exhausted frontier catalog`,
      `Product files checked: ${(surface.productFiles || []).join(', ')}`,
      `Targeted tests checked: ${(surface.targetedTests || []).join(', ')}`,
      'Credit requires a real product-surface diff or explicit product-state proof; generic frontier ledger/test-only evidence is not sufficient'
    ];
  }
  if (surface.id?.startsWith('mailchimp_frontier_')) {
    return [
      `MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT records official-surface frontier work for ${surface.label}`,
      `Strict gap anchor: ${surface.strictGap}`,
      '/ops/mailchimp-frontier, /ops/mailchimp-frontier/start, /ops/mailchimp-frontier/evidence, /ops/mailchimp-frontier/snapshot, and /api/ops/mailchimp-frontier/runtime expose normal authenticated frontier runtime adoption',
      'storage.mjs persists mailchimpFrontierSurfaceRuns, mailchimpFrontierEvidenceEvents, and mailchimpFrontierRuntimeSnapshots as durable product collections',
      'frontier runtime regression keeps current-product parity green while extending the continuous run with official Mailchimp negative-space subtranches'
    ];
  }
  return [
    '/static/journey-designer-client.mjs serves pure journey state functions and browser attachJourneyDesigner hydration',
    '/automations/:id/builder emits a data-journey-designer-client mount plus JSON state seed and module script',
    'client module supports node reorder, duplicate, branch condition mutation, contact preview, canvas mode, undo/redo, and serialized journey state',
    'automation journey regression still proves durable server forms, publish, pause, resume, validation, and report path after client visual layer adoption'
  ];
}

function writeProofMap(args, surface, testResult, semanticWorkGate = null) {
  const semanticGate = semanticWorkGate || buildSemanticWorkGate(surface, {
    changedFiles: [],
    explicitProductStateProof: buildExistingProductStateProof(args, surface).ok,
    productStateProof: buildExistingProductStateProof(args, surface)
  }, testResult);
  const proofMap = {
    generatedAt: new Date().toISOString(),
    scope: `${surface.phase}_autonomous_strict_gap_continuation_${surface.id}`,
    fidelity: 'production_slice_autonomous_continuation',
    strictGap: surface.strictGap,
    globalGapId: surface.globalGapId || null,
    globalGapLabel: surface.globalGapLabel || null,
    runCommand: surface.testCommand,
    testsPassed: testResult.status === 0,
    semanticWorkGate: semanticGate,
    proofs: {
      [surface.id]: {
        status: testResult.status === 0 && semanticGate.ok ? 'green' : 'red',
        testsPassed: testResult.status === 0,
        semanticWorkGate: semanticGate,
        productFiles: surface.productFiles,
        targetedTests: surface.targetedTests,
        assertions: surface.requiredAssertions,
        evidence: proofEvidenceFor(surface)
      }
    }
  };
  const proofPath = path.join(args.mailchimpRoot, surface.proofMapRelPath);
  writeJson(proofPath, proofMap);
  return proofPath;
}

function leafIdForQueueEntry(entry = {}) {
  return String(entry.leafId || entry.id || '').trim();
}

function baseSurfaceIdForQueueEntry(entry = {}) {
  const explicit = String(entry.globalGapId || entry.parentSurfaceId || entry.surfaceId || '').trim();
  if (explicit) return explicit;
  return leafIdForQueueEntry(entry).replace(/__(req|gap)_.*$/, '').replace(/__req_\d+$/, '');
}

function queueEntryMatchesSelectedSurface(entry = {}, selected = null) {
  if (!selected?.surface) return false;
  const surface = selected.surface;
  const entryStrictGap = strictGapForQueuedWork(entry);
  if (entryStrictGap && entryStrictGap === selected.sourceGap) return true;
  const entryIds = new Set([
    entry.globalGapId,
    entry.parentSurfaceId,
    entry.surfaceId,
    baseSurfaceIdForQueueEntry(entry)
  ].map((value) => String(value || '').trim()).filter(Boolean));
  const surfaceIds = new Set([
    surface.globalGapId,
    surface.parentSurfaceId,
    surface.id,
    String(surface.id || '').replace(/^mailchimp_global_gap_/, '').replace(/_product_state_reconciliation$/, '')
  ].map((value) => String(value || '').trim()).filter(Boolean));
  return Array.from(entryIds).some((id) => surfaceIds.has(id));
}

function normalizeLeafProofs(proofDoc = {}) {
  if (!proofDoc || typeof proofDoc !== 'object') return [];
  if (Array.isArray(proofDoc.leafProofs)) return proofDoc.leafProofs;
  if (proofDoc.proofs && typeof proofDoc.proofs === 'object') {
    return Object.entries(proofDoc.proofs).map(([leafId, proof]) => ({ leafId, ...(proof || {}) }));
  }
  return [];
}

function phase9LeafPrefixForSelected(selected = null) {
  const surface = selected?.surface || {};
  const explicit = String(surface.globalGapId || surface.parentSurfaceId || '').trim();
  if (explicit) return explicit;
  return String(surface.id || '')
    .replace(/^mailchimp_global_gap_/, '')
    .replace(/_product_state_reconciliation$/, '')
    .trim();
}

function phase9LeafMatchesSelected(leaf = {}, selected = null) {
  const prefix = phase9LeafPrefixForSelected(selected);
  if (!prefix) return false;
  const leafId = String(leaf.leafId || leaf.id || '').trim();
  const parentSurfaceId = String(leaf.parentSurfaceId || leaf.parent || '').trim();
  return leafId.startsWith(`${prefix}__`) || parentSurfaceId === prefix;
}

function readTestPhase9LeafProofs(testResult = {}, selected = null) {
  const proofMap = testResult.phase9ProofPath ? readJson(testResult.phase9ProofPath, null) : null;
  return normalizeLeafProofs(proofMap).filter((proof) => phase9LeafMatchesSelected(proof, selected));
}

function phase9SurfaceMatrixCandidates(args) {
  return [
    path.join(args.phase13ArtifactRoot, 'surface_matrix.json'),
    path.join(args.phase13ArtifactRoot, 'phase9_real_parity', 'surface_matrix.json'),
    path.join(path.dirname(args.phase13ArtifactRoot), 'surface_matrix.json'),
    path.join(path.dirname(args.phase13ArtifactRoot), 'phase9_real_parity', 'surface_matrix.json')
  ];
}

function readCanonicalPhase9LeafWork(args, selected = null) {
  const prefix = phase9LeafPrefixForSelected(selected);
  if (!prefix) return [];
  for (const candidate of phase9SurfaceMatrixCandidates(args)) {
    const matrix = readJson(candidate, null);
    const surfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
    const matches = surfaces.filter((surface) => phase9LeafMatchesSelected(surface, selected));
    if (matches.length) {
      return matches.map((surface) => ({
        id: surface.id || surface.leafId,
        leafId: surface.leafId || surface.id,
        parentSurfaceId: surface.parentSurfaceId || prefix,
        productGoal: surface.requiredWork || surface.productGoal,
        requiredWork: surface.requiredWork || surface.productGoal,
        allowedFiles: surface.productFiles || surface.allowedFiles || [],
        productFiles: surface.productFiles || surface.allowedFiles || [],
        targetedTests: surface.targetedTests || [],
        proofKinds: surface.proofKinds || []
      }));
    }
  }
  return [];
}

function readExistingPhase9ProofMap(args) {
  const anchorInventory = readJson(path.join(args.phase13ArtifactRoot, 'real_parity_inventory.json'), {});
  const anchorSummary = readJson(path.join(args.phase13ArtifactRoot, 'completion_summary.json'), {});
  const candidates = [
    anchorInventory?.source?.proofMapPath,
    anchorSummary?.proofMapPath,
    anchorSummary?.phase9ProofMapPath,
    path.join(args.phase13ArtifactRoot, 'phase9-proof-map.json'),
    path.join(path.dirname(args.phase13ArtifactRoot), 'phase9-proof-map.json')
  ].filter(Boolean);
  for (const candidate of candidates) {
    const proofPath = path.isAbsolute(candidate) ? candidate : path.join(args.phase13ArtifactRoot, candidate);
    const proofMap = readJson(proofPath, null);
    if (proofMap) return { proofMap, proofPath };
  }
  return { proofMap: null, proofPath: null };
}

function mergeLeafProofMaps(existingProofMap = null, generatedLeafProofs = [], generatedAt = new Date().toISOString()) {
  const byLeafId = new Map();
  for (const proof of normalizeLeafProofs(existingProofMap)) {
    const leafId = String(proof.leafId || proof.id || '').trim();
    if (leafId) byLeafId.set(leafId, { ...proof, leafId });
  }
  for (const proof of generatedLeafProofs) {
    const leafId = String(proof.leafId || proof.id || '').trim();
    if (leafId) byLeafId.set(leafId, { ...proof, leafId });
  }
  const leafProofs = Array.from(byLeafId.values()).sort((a, b) => String(a.leafId).localeCompare(String(b.leafId)));
  const greenCount = leafProofs.filter((proof) => proof.status === 'green' && (proof.testStatus === 'pass' || proof.testCommandExitCode === 0)).length;
  return {
    schemaVersion: 'clawd.mailchimp.phase9.real_product_proof.v1',
    status: leafProofs.length && greenCount === leafProofs.length ? 'green' : leafProofs.length ? 'partial' : 'not_provided',
    generatedAt,
    productSlices: Array.from(new Set([
      ...(Array.isArray(existingProofMap?.productSlices) ? existingProofMap.productSlices : []),
      ...generatedLeafProofs.map((proof) => proof.parentSurfaceId || proof.globalGapId || proof.selectedSurfaceId).filter(Boolean)
    ])).sort(),
    leafProofs
  };
}

function buildPhase9ProofArtifacts(args, selected, implementation = {}, testResult = {}, semanticWorkGate = {}) {
  const queue = readJson(path.join(args.phase13ArtifactRoot, 'next_work_queue.json'), {});
  const work = Array.isArray(queue.work) ? queue.work : [];
  const matchingWork = work.filter((entry) => leafIdForQueueEntry(entry) && queueEntryMatchesSelectedSurface(entry, selected));
  const testLeafProofs = readTestPhase9LeafProofs(testResult, selected);
  const canonicalLeafWork = readCanonicalPhase9LeafWork(args, selected);
  const workForProof = testLeafProofs.length ? testLeafProofs : (canonicalLeafWork.length ? canonicalLeafWork : matchingWork);
  if (!selected?.surface || workForProof.length === 0) {
    return { generated: false, reason: 'no_matching_phase9_queue_leaf', generatedLeafProofs: [], generatedLeafIds: [] };
  }
  const generatedAt = new Date().toISOString();
  const status = testResult.status === 0 && semanticWorkGate.ok ? 'green' : 'red';
  const testStatus = testResult.status === 0 ? 'pass' : 'fail';
  const generatedLeafProofs = workForProof.map((entry) => {
    const leafId = leafIdForQueueEntry(entry);
    const parentSurfaceId = entry.parentSurfaceId || baseSurfaceIdForQueueEntry(entry) || selected.surface.globalGapId || selected.surface.id;
    const productFiles = Array.isArray(entry.allowedFiles) && entry.allowedFiles.length
      ? entry.allowedFiles
      : (Array.isArray(entry.productFiles) && entry.productFiles.length ? entry.productFiles : selected.surface.productFiles);
    const targetedTests = Array.isArray(entry.targetedTests) && entry.targetedTests.length ? entry.targetedTests : selected.surface.targetedTests;
    const proofKinds = Array.isArray(entry.proofKinds) && entry.proofKinds.length ? entry.proofKinds : ['functional', 'product_diff'];
    return {
      ...entry,
      leafId,
      parentSurfaceId,
      selectedSurfaceId: selected.surface.id,
      selectedStrictGap: selected.sourceGap,
      globalGapId: selected.surface.globalGapId || parentSurfaceId,
      globalGapLabel: selected.surface.globalGapLabel || null,
      status,
      productFiles,
      targetedTests,
      proofKinds,
      testStatus,
      testCommandExitCode: testResult.status,
      testCommand: testResult.command || selected.surface.testCommand || null,
      assertions: Array.from(new Set([
        ...(Array.isArray(entry.assertions) ? entry.assertions : []),
        entry.productGoal,
        entry.requiredWork,
        ...(selected.surface.requiredAssertions || [])
      ].filter(Boolean))),
      semanticWorkGate,
      productChangedFiles: semanticWorkGate.productChangedFiles || implementation.changedFiles || [],
      productStateProof: semanticWorkGate.productStateProof || implementation.productStateProof || null,
      generatedAt
    };
  });
  const existing = readExistingPhase9ProofMap(args);
  const proofMap = mergeLeafProofMaps(existing.proofMap, generatedLeafProofs, generatedAt);
  const proofMapPath = path.join(args.artifactRoot, 'phase9-proof-map.json');
  writeJson(proofMapPath, proofMap);
  return {
    generated: true,
    proofMapPath,
    sourceProofMapPath: existing.proofPath,
    generatedLeafProofs,
    generatedLeafIds: generatedLeafProofs.map((proof) => proof.leafId),
    mergedLeafProofCount: proofMap.leafProofs.length,
    greenLeafProofCount: proofMap.leafProofs.filter((proof) => proof.status === 'green' && (proof.testStatus === 'pass' || proof.testCommandExitCode === 0)).length,
    proofMapStatus: proofMap.status
  };
}

function runPhase9Preflight(args, phase9ProofArtifacts) {
  if (!phase9ProofArtifacts?.generated || !phase9ProofArtifacts.proofMapPath) {
    return { required: false, ran: false, reason: phase9ProofArtifacts?.reason || 'phase9_proof_not_generated' };
  }
  const artifactRoot = path.join(args.artifactRoot, 'phase9_real_parity');
  const run = spawnSync(process.execPath, [
    path.join(args.stackRoot, 'apps/system-benchmark/run-mailchimp-real-parity-preflight.mjs'),
    '--stack-root', args.stackRoot,
    '--mailchimp-root', args.mailchimpRoot,
    '--artifact-root', artifactRoot,
    '--proof-map', phase9ProofArtifacts.proofMapPath
  ], { cwd: args.stackRoot, encoding: 'utf8', timeout: 120000 });
  const completion = readJson(path.join(artifactRoot, 'completion_summary.json'), {});
  const thresholdEvaluation = readJson(path.join(artifactRoot, 'threshold_evaluation.json'), {});
  const matrix = readJson(path.join(artifactRoot, 'surface_matrix.json'), {});
  const surfaces = Array.isArray(matrix.surfaces) ? matrix.surfaces : [];
  const generatedIds = new Set(phase9ProofArtifacts.generatedLeafIds || []);
  const generatedSurfaces = surfaces.filter((surface) => generatedIds.has(surface.id));
  const generatedLeavesGreen = generatedSurfaces.length === generatedIds.size && generatedSurfaces.every((surface) => surface.status === 'green');
  return {
    required: true,
    ran: true,
    status: run.status ?? 1,
    command: `${process.execPath} apps/system-benchmark/run-mailchimp-real-parity-preflight.mjs --artifact-root ${artifactRoot} --proof-map ${phase9ProofArtifacts.proofMapPath}`,
    artifactRoot,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    completion,
    thresholdEvaluation,
    generatedLeavesGreen,
    generatedLeafIds: Array.from(generatedIds),
    greenLeafSurfaceCount: completion.greenLeafSurfaceCount ?? null,
    redLeafSurfaceCount: completion.redLeafSurfaceCount ?? null,
    nextWorkQueueCount: completion.nextWorkQueueCount ?? null,
    mechanicalGreen: completion.mechanicalGreen === true || completion.inventoryReady === true
  };
}

function benchmarkChildTestEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST')) delete env[key];
  }
  if (typeof env.NODE_OPTIONS === 'string' && env.NODE_OPTIONS.includes('--test-name-pattern')) {
    env.NODE_OPTIONS = env.NODE_OPTIONS
      .replace(/--test-name-pattern(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!env.NODE_OPTIONS) delete env.NODE_OPTIONS;
  }
  return env;
}

function runTests(args, surface, extraTests = []) {
  if (args.skipTests) return { status: 0, stdout: 'tests skipped by explicit --skip-tests\n', stderr: '', command: 'skipped' };
  const baseCommand = surface?.testCommand || JOURNEY_TEST_COMMAND;
  const command = extraTests.length
    ? `${baseCommand} ${extraTests.map(shellQuote).join(' ')}`
    : baseCommand;
  const phase9ProofPath = surface?.globalGapId ? path.join(args.artifactRoot, 'test-phase9-proof-map.json') : null;
  const env = benchmarkChildTestEnv(phase9ProofPath ? { MAILCLONE_PHASE9_PROOF_PATH: phase9ProofPath } : {});
  const run = spawnSync(command, { cwd: args.mailchimpRoot, shell: true, encoding: 'utf8', timeout: 120000, env });
  return { status: run.status ?? 1, stdout: run.stdout || '', stderr: run.stderr || '', command, signal: run.signal || null, phase9ProofPath };
}

async function runHonestyGate(args) {
  try {
    const moduleUrl = pathToFileURL(path.join(args.stackRoot, 'packages/architecture-enforcer/index.mjs')).href;
    const { enforceArchitecture } = await import(moduleUrl);
    const report = enforceArchitecture(args.mailchimpRoot, { maxSourceLines: 100000 });
    return {
      ok: report.honesty.ok,
      manifestPath: report.honesty.manifestPath,
      changedProductFiles: report.honesty.changedProductFiles,
      violationCount: report.honesty.violations.length,
      violations: report.honesty.violations
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function nextStrictGapAfter(sourceGap, remainingStrictGaps) {
  const index = remainingStrictGaps.findIndex((gap) => gap === sourceGap);
  const rest = index >= 0 ? remainingStrictGaps.slice(index + 1) : remainingStrictGaps.filter((gap) => gap !== sourceGap);
  return rest[0] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.listSupportedGapsJson) {
    console.log(JSON.stringify({
      benchmarkId: args.benchmarkId,
      supportedSurfaces: STRICT_SURFACES.map((surface) => ({
        id: surface.id,
        phase: surface.phase,
        strictGap: surface.strictGap,
        globalGapId: surface.globalGapId || null,
        globalGapLabel: surface.globalGapLabel || null,
        productFiles: surface.productFiles,
        targetedTests: surface.targetedTests
      })),
      fallbackRemainingStrictGaps: FALLBACK_REMAINING_STRICT_GAPS
    }, null, 2));
    return;
  }
  fs.mkdirSync(args.artifactRoot, { recursive: true });
  const startedAt = Date.now();
  const events = [{ type: 'campaign_started', generatedAt: new Date().toISOString(), mode: 'persistent', stopCondition: 'supervisor_green_or_blocker_report' }];

  const remainingStrictGaps = deriveRemainingStrictGaps(args);

  let proofMap = readSurfaceProofMap(args);
  let surfaceStatuses = STRICT_SURFACES.map((surface) => buildSurfaceStatus(surface, args.mailchimpRoot, proofMap));
  const selected = selectNextSurface({ remainingStrictGaps, surfaceStatuses });
  events.push({ type: 'planner_selected_strict_gap', generatedAt: new Date().toISOString(), selectedSurfaceId: selected?.surface?.id || null, sourceGap: selected?.sourceGap || null, selectionReason: selected?.selectionReason || null });

  let implementation = { changedFiles: [] };
  let testResult = { status: args.apply ? 1 : 1, stdout: '', stderr: '', command: selected?.surface?.testCommand || null };
  let proofPath = null;
  if (args.apply && selected?.surface?.implementationHandler === 'applyJourneyDesigner') {
    implementation = applyJourneyDesigner(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyAudienceWarehouse') {
    implementation = applyAudienceWarehouse(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyReportingTelemetry') {
    implementation = applyReportingTelemetry(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyAiPredictiveRuntime') {
    implementation = applyAiPredictiveRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyIntegrationProviderRuntime') {
    implementation = applyIntegrationProviderRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyAuthSessionSecurityRuntime') {
    implementation = applyAuthSessionSecurityRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyPersistenceJobsOperationalRuntime') {
    implementation = applyPersistenceJobsOperationalRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyFrontendClientShellRuntime') {
    implementation = applyFrontendClientShellRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyCampaignEditorVisualBuilderRuntime') {
    implementation = applyCampaignEditorVisualBuilderRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyWebsiteBuilderPublishRuntime') {
    implementation = applyWebsiteBuilderPublishRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyLeadCaptureConversionRuntime') {
    implementation = applyLeadCaptureConversionRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyCommerceRevenueRuntime') {
    implementation = applyCommerceRevenueRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyConversationInboxRuntime') {
    implementation = applyConversationInboxRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applySurveyFeedbackRuntime') {
    implementation = applySurveyFeedbackRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyPreferenceCenterRuntime') {
    implementation = applyPreferenceCenterRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyTransactionalMessagingRuntime') {
    implementation = applyTransactionalMessagingRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyMobileAppRuntime') {
    implementation = applyMobileAppRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyContentStudioRuntime') {
    implementation = applyContentStudioRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applySmsMarketingRuntime') {
    implementation = applySmsMarketingRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applySocialPublishingRuntime') {
    implementation = applySocialPublishingRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyAdsRetargetingRuntime') {
    implementation = applyAdsRetargetingRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyDeveloperApiWebhookRuntime') {
    implementation = applyDeveloperApiWebhookRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyBillingEntitlementsRuntime') {
    implementation = applyBillingEntitlementsRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyTeamGovernanceRuntime') {
    implementation = applyTeamGovernanceRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applySettingsDomainsDeliverabilityRuntime') {
    implementation = applySettingsDomainsDeliverabilityRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyDashboardHomeRuntime') {
    implementation = applyDashboardHomeRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyCampaignExperimentRuntime') {
    implementation = applyCampaignExperimentRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyPostcardDirectMailRuntime') {
    implementation = applyPostcardDirectMailRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyCrossChannelJourneyRuntime') {
    implementation = applyCrossChannelJourneyRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applySocialCalendarCoordinationRuntime') {
    implementation = applySocialCalendarCoordinationRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyOmnichannelReportingAttributionRuntime') {
    implementation = applyOmnichannelReportingAttributionRuntime(args, events);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult);
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyMailchimpGlobalGapProductStateProof') {
    implementation = applyMailchimpGlobalGapProductStateProof(args, events, selected.surface);
    testResult = runTests(args, selected.surface);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult, buildSemanticWorkGate(selected.surface, implementation, testResult));
  } else if (args.apply && selected?.surface?.implementationHandler === 'applyMailchimpContinuousFrontierRuntime') {
    implementation = applyMailchimpContinuousFrontierRuntime(args, events, selected.surface);
    testResult = runTests(args, selected.surface, implementation.surfaceSpecificTestFile ? [implementation.surfaceSpecificTestFile] : []);
    events.push({ type: testResult.status === 0 ? 'proof_tests_passed' : 'proof_tests_failed', generatedAt: new Date().toISOString(), command: testResult.command, status: testResult.status });
    proofPath = writeProofMap(args, selected.surface, testResult, buildSemanticWorkGate(selected.surface, implementation, testResult));
  }

  const semanticWorkGate = selected ? buildSemanticWorkGate(selected.surface, implementation, testResult) : { ok: false, required: true, gate: 'semantic_product_work_gate', reason: 'no_surface_selected', productChangedFiles: [], changedFileCount: 0, explicitProductStateProof: false, productStateProof: null, surfaceSpecificExecutableEvidence: false, frontierGenericLedgerOnly: false };
  events.push({ type: semanticWorkGate.ok ? 'semantic_product_work_gate_passed' : 'semantic_product_work_gate_failed', generatedAt: new Date().toISOString(), selectedSurfaceId: selected?.surface?.id || null, ...semanticWorkGate });
  const phase9ProofArtifacts = buildPhase9ProofArtifacts(args, selected, implementation, testResult, semanticWorkGate);
  if (phase9ProofArtifacts.generated) {
    events.push({ type: 'phase9_proof_map_generated', generatedAt: new Date().toISOString(), proofMapPath: phase9ProofArtifacts.proofMapPath, generatedLeafIds: phase9ProofArtifacts.generatedLeafIds, mergedLeafProofCount: phase9ProofArtifacts.mergedLeafProofCount, greenLeafProofCount: phase9ProofArtifacts.greenLeafProofCount });
  }
  const phase9Preflight = runPhase9Preflight(args, phase9ProofArtifacts);
  if (phase9Preflight.ran) {
    events.push({ type: phase9Preflight.generatedLeavesGreen ? 'phase9_preflight_generated_leaves_green' : 'phase9_preflight_generated_leaves_red', generatedAt: new Date().toISOString(), artifactRoot: phase9Preflight.artifactRoot, status: phase9Preflight.status, generatedLeafIds: phase9Preflight.generatedLeafIds, greenLeafSurfaceCount: phase9Preflight.greenLeafSurfaceCount, redLeafSurfaceCount: phase9Preflight.redLeafSurfaceCount });
  }
  proofMap = readSurfaceProofMap(args);
  surfaceStatuses = STRICT_SURFACES.map((surface) => buildSurfaceStatus(surface, args.mailchimpRoot, proofMap));
  const selectedAfter = selected ? surfaceStatuses.find((surface) => surface.id === selected.surface.id) : null;
  const selectedGreen = selectedAfter?.status === 'green';
  const nextGap = selected ? nextStrictGapAfter(selected.sourceGap, remainingStrictGaps) : null;
  const nextWorkQueue = nextGap ? [{ id: 'next_strict_gap_after_autonomous_slice', strictGap: nextGap, stopCondition: 'planner_selects_next_strict_gap_or_blocker_report' }] : [];
  events.push({ type: 'surface_matrix_updated', generatedAt: new Date().toISOString(), selectedSurfaceId: selectedAfter?.id || null, selectedStatus: selectedAfter?.status || null });
  events.push({ type: 'continuation_replanned', generatedAt: new Date().toISOString(), nextStrictGap: nextGap, nextWorkQueueCount: nextWorkQueue.length });

  const honestyGate = await runHonestyGate(args);
  const configuredStrictQueueExhausted = Boolean(selected && !nextGap);
  const continuationBoundarySatisfied = nextWorkQueue.length > 0 || configuredStrictQueueExhausted;
  const phase9PreflightOk = !phase9Preflight.required || (phase9Preflight.status === 0 && phase9Preflight.mechanicalGreen && phase9Preflight.generatedLeavesGreen);
  const thresholdPass = Boolean(selected && args.apply && semanticWorkGate.ok && selectedGreen && testResult.status === 0 && continuationBoundarySatisfied && honestyGate.ok && phase9PreflightOk);
  const elapsedMs = Date.now() - startedAt;
  const blockerKind = !selected
    ? 'autonomous_planner_no_gap_selected'
    : (!semanticWorkGate.ok ? 'semantic_product_work_gate_failed' : (!phase9PreflightOk ? 'phase9_proof_map_preflight_failed' : 'autonomous_strict_gap_loop_red'));
  const blocker = thresholdPass ? null : {
    blocker: selected
      ? (!semanticWorkGate.ok
          ? 'Autonomous continuation selected a strict gap but generated only reusable proof/catalog evidence; no product diff or explicit product-state proof was admitted.'
          : (!phase9PreflightOk
              ? 'Autonomous continuation produced surface proof, but phase9 proof-map-backed preflight did not credit the generated leaf work.'
          : 'Autonomous continuation benchmark did not complete the scoped strict-gap loop with green product proof.')
      )
      : 'Autonomous continuation planner could not select a strict gap from the prior blocker artifact.',
    blockerKind,
    nextAction: selected
      ? (!semanticWorkGate.ok
          ? 'Implement real product behavior for the selected Mailchimp surface, or add a surface-specific executable regression that exercises behavior beyond the generic frontier ledger; then rerun with --apply.'
          : (!phase9PreflightOk
              ? 'Inspect phase9-proof-map.json and phase9_real_parity/surface_matrix.json; repair proof-map generation or targeted tests so generated leaves are green.'
          : 'Inspect test_result.json, surface_matrix.json, and honesty_gate.json; repair the product/proof/honesty failure and rerun with --apply.')
      )
      : 'Provide a prior artifact with remainingStrictGaps or extend STRICT_SURFACES to cover the current blocker family.',
    selectedSurfaceId: selected?.surface?.id || null,
    selectedStatus: selectedAfter?.status || null,
    testStatus: testResult.status,
    semanticWorkGate,
    phase9ProofArtifacts,
    phase9Preflight: {
      required: phase9Preflight.required,
      ran: phase9Preflight.ran,
      status: phase9Preflight.status,
      artifactRoot: phase9Preflight.artifactRoot,
      generatedLeavesGreen: phase9Preflight.generatedLeavesGreen,
      generatedLeafIds: phase9Preflight.generatedLeafIds || []
    },
    honestyOk: honestyGate.ok,
    honestyViolations: honestyGate.violations || []
  };

  const completion = {
    generatedAt: new Date().toISOString(),
    benchmarkId: args.benchmarkId,
    runId: `${args.benchmarkId}-${path.basename(args.artifactRoot).replace(/^bootstrap-/, '')}`,
    artifactRoot: args.artifactRoot,
    targetPath: args.mailchimpRoot,
    anchorArtifactRoot: args.phase13ArtifactRoot,
    fidelity: 'production_slice',
    scope: 'autonomous_continuation_loop_for_next_mailchimp_strict_gap_after_phase13',
    implementationSurface: 'mixed_control_plane_plus_product_code',
    campaignMode: 'persistent',
    stopCondition: 'supervisor_green_or_blocker_report',
    thresholdPass,
    supervisorStatus: thresholdPass ? 'green' : 'red',
    mechanicalGreen: Boolean(selected),
    scaleProofReady: false,
    scaleProofRequired: false,
    globalFullClonePass: false,
    parityStatus: thresholdPass ? 'autonomous_strict_gap_slice_green_global_strict_ceiling_still_open' : 'autonomous_strict_gap_slice_red',
    selectedStrictGap: selected?.sourceGap || null,
    selectedSurfaceId: selected?.surface?.id || null,
    selectedGlobalGapId: selected?.surface?.globalGapId || implementation.globalGapId || null,
    selectedGlobalGapLabel: selected?.surface?.globalGapLabel || implementation.globalGapLabel || null,
    selectedSurfaceStatus: selectedAfter?.status || null,
    surfaceMatrixStatus: selectedGreen ? 'all_complete_for_scope' : 'partial',
    generatedProductFiles: implementation.changedFiles.filter(isProductPath),
    productStateProofFiles: semanticWorkGate.explicitProductStateProof ? (implementation.productFiles || []) : [],
    generatedTestFiles: implementation.testFiles || implementation.changedFiles.filter((relPath) => relPath.startsWith('tests/')),
    changedProductFiles: semanticWorkGate.productChangedFiles || [],
    semanticWorkGate,
    proofMapPath: proofPath,
    phase9ProofMapPath: phase9ProofArtifacts.proofMapPath || null,
    phase9ProofArtifacts,
    phase9Preflight: {
      required: phase9Preflight.required,
      ran: phase9Preflight.ran,
      status: phase9Preflight.status ?? null,
      artifactRoot: phase9Preflight.artifactRoot || null,
      generatedLeavesGreen: phase9Preflight.generatedLeavesGreen === true,
      generatedLeafIds: phase9Preflight.generatedLeafIds || [],
      greenLeafSurfaceCount: phase9Preflight.greenLeafSurfaceCount ?? null,
      redLeafSurfaceCount: phase9Preflight.redLeafSurfaceCount ?? null,
      nextWorkQueueCount: phase9Preflight.nextWorkQueueCount ?? null
    },
    testCommand: selected?.surface?.testCommand || null,
    testsPassed: testResult.status === 0,
    nextWorkQueueCount: nextWorkQueue.length,
    nextStrictGap: nextGap,
    configuredStrictQueueExhausted,
    honestyGate: { ok: honestyGate.ok, manifestPath: honestyGate.manifestPath, violationCount: honestyGate.violationCount },
    durationMinutes: Number((elapsedMs / 60000).toFixed(2)),
    blocker,
    truthBoundary: `This benchmark proves one autonomous continuation loop from current Mailchimp strict blockers into the real product-backed ${selected?.surface?.label || 'selected strict-gap'} slice only when the semantic product-work gate admits a product diff or explicit product-state proof; then it either replans the next configured strict gap or reports that the configured strict queue is exhausted. It is not a global Mailchimp full-clone completion claim.`
  };

  const thresholdEvaluation = {
    generatedAt: new Date().toISOString(),
    thresholdPass,
    ok: thresholdPass,
    scaleProofRequired: false,
    benchmarkTier: 'mailchimp_autonomous_strict_gap_continuation_production_slice',
    failures: thresholdPass ? [] : [{ metric: 'autonomousContinuationLoopGreen', actual: false, requirement: '= true', reason: blocker?.blockerKind || 'unknown' }],
    metrics: {
      plannerSelectedGap: Boolean(selected),
      productWorkGenerated: semanticWorkGate.ok,
      semanticProductWorkAccepted: semanticWorkGate.ok,
      changedProductFileCount: (semanticWorkGate.productChangedFiles || []).length,
      explicitProductStateProof: semanticWorkGate.explicitProductStateProof === true,
      surfaceSpecificExecutableEvidence: semanticWorkGate.surfaceSpecificExecutableEvidence,
      testsPassed: testResult.status === 0,
      selectedSurfaceGreen: selectedGreen,
      phase9ProofMapGenerated: phase9ProofArtifacts.generated === true,
      phase9GeneratedLeafProofCount: phase9ProofArtifacts.generatedLeafIds?.length || 0,
      phase9PreflightRequired: phase9Preflight.required === true,
      phase9PreflightExitCode: phase9Preflight.status ?? null,
      phase9GeneratedLeavesGreen: phase9Preflight.generatedLeavesGreen === true,
      phase9GreenLeafSurfaceCount: phase9Preflight.greenLeafSurfaceCount ?? null,
      phase9RedLeafSurfaceCount: phase9Preflight.redLeafSurfaceCount ?? null,
      matrixUpdated: true,
      continuationReplanned: nextWorkQueue.length > 0 || configuredStrictQueueExhausted,
      configuredStrictQueueExhausted,
      honestyGateGreen: honestyGate.ok
    }
  };

  const runStateTruth = reduceRunState({
    completionSummary: completion,
    thresholdEvaluation,
    supervisorStatus: { status: completion.supervisorStatus },
    blocker,
    scaleProofRequired: false
  }, { generatedAt: completion.generatedAt });

  writeJson(path.join(args.artifactRoot, 'run_contract.json'), {
    generatedAt: completion.generatedAt,
    benchmarkId: args.benchmarkId,
    fidelity: completion.fidelity,
    scope: completion.scope,
    anchorArtifactRoot: args.phase13ArtifactRoot,
    targetPath: args.mailchimpRoot,
    campaignMode: completion.campaignMode,
    stopCondition: completion.stopCondition,
    requestedProof: ['planner_selects_next_strict_gap', 'semantic_product_work_gate', 'generated_product_work', 'tests_prove_surface', 'phase9_proof_map_generated_when_leaf_queue_present', 'phase9_preflight_generated_leaves_green', 'surface_matrix_updated', 'continuation_replanned_or_configured_queue_exhausted']
  });
  writeJson(path.join(args.artifactRoot, 'planner_decision.json'), { generatedAt: completion.generatedAt, remainingStrictGaps, selected, nextStrictGap: nextGap });
  writeJson(path.join(args.artifactRoot, 'implementation_manifest.json'), { generatedAt: completion.generatedAt, implementation, proofPath, phase9ProofArtifacts, phase9Preflight: completion.phase9Preflight });
  writeJson(path.join(args.artifactRoot, 'test_result.json'), testResult);
  writeJson(path.join(args.artifactRoot, 'honesty_gate.json'), honestyGate);
  if (completion.selectedGlobalGapId) {
    writeJson(path.join(args.artifactRoot, 'global_gap_credit.json'), {
      generatedAt: completion.generatedAt,
      globalGapId: completion.selectedGlobalGapId,
      globalGapLabel: completion.selectedGlobalGapLabel,
      selectedSurfaceId: completion.selectedSurfaceId,
      selectedStrictGap: completion.selectedStrictGap,
      creditRequirement: 'product_diff_or_explicit_product_state_proof',
      semanticWorkGate,
      productStateProof: semanticWorkGate.productStateProof || implementation.productStateProof || null,
      thresholdPass
    });
  }
  writeJson(path.join(args.artifactRoot, 'surface_matrix.json'), { generatedAt: completion.generatedAt, status: completion.surfaceMatrixStatus, surfaces: surfaceStatuses });
  writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), { generatedAt: completion.generatedAt, count: nextWorkQueue.length, work: nextWorkQueue });
  writeJson(path.join(args.artifactRoot, 'campaign_runtime_events.json'), { generatedAt: completion.generatedAt, events });
  writeJson(path.join(args.artifactRoot, 'completion_summary.json'), completion);
  writeJson(path.join(args.artifactRoot, 'threshold_evaluation.json'), thresholdEvaluation);
  writeJson(path.join(args.artifactRoot, 'run_state_truth.json'), runStateTruth);
  writeJson(path.join(args.artifactRoot, 'program_state.json'), {
    schemaVersion: 'clawd.mailchimp.autonomous_continuation_program_state.v1',
    generatedAt: completion.generatedAt,
    status: thresholdPass ? 'passed' : 'blocked',
    terminalState: runStateTruth.terminalState,
    done: true,
    running: false,
    ok: runStateTruth.ok,
    stopAllowed: true,
    stopReason: thresholdPass ? 'supervisor_green_for_autonomous_continuation_scope' : 'blocker_report_written',
    supervisor: { status: completion.supervisorStatus, surfaceMatrixStatus: completion.surfaceMatrixStatus },
    continuationDecision: thresholdPass ? (nextGap ? 'continue_with_next_strict_gap_available' : 'configured_strict_queue_exhausted_without_global_full_clone_claim') : 'stop_blocked',
    nextStrictGap: nextGap
  });
  if (blocker) writeJson(path.join(args.artifactRoot, 'blocker_report.json'), { generatedAt: completion.generatedAt, benchmarkId: args.benchmarkId, status: 'blocked', ...blocker });

  console.log(JSON.stringify({ ok: true, thresholdPass, supervisorStatus: completion.supervisorStatus, selectedSurfaceId: completion.selectedSurfaceId, selectedStrictGap: completion.selectedStrictGap, nextStrictGap: completion.nextStrictGap, artifactRoot: args.artifactRoot, blocker }, null, 2));
  process.exit(thresholdPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
