#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRunContractTemplate, bootstrapTransferBenchmark, upsertBenchmarkScoreboardRow } from '../../packages/system-benchmark/index.mjs';
import { PMHNP_TIER2_SCENARIOS } from './pmhnp-tier2-scenarios.mjs';
import { PMHNP_SITE_TIER2_SURFACES } from './pmhnp-site-tier2-surfaces.mjs';
import {
  buildGame100AgentReadinessSurfaces,
  GAME_100_AGENT_ADMISSION_GATES,
  GAME_100_AGENT_READINESS_LADDER,
  GAME_100_AGENT_REPAIR_LANE,
  GAME_100_AGENT_SCHEDULER_POLICY,
  GAME_100_AGENT_VERIFICATION_POLICY
} from './game-100-agent-surfaces.mjs';

const SEMANTIC_ARCHITECTURE_SURFACES = Object.freeze([
  {
    id: 'audience_lifecycle_runtime',
    label: 'Audience lifecycle runtime and persistence contract',
    primary: 'packages/app/audience-lifecycle.mjs',
    companion: 'packages/app/storage/audience-store.mjs'
  },
  {
    id: 'campaign_workflow_api',
    label: 'Campaign workflow API and domain contract',
    primary: 'apps/web/routes/campaign-workflow.mjs',
    companion: 'packages/app/campaign-workflow.mjs'
  },
  {
    id: 'journey_job_runtime',
    label: 'Journey job runtime and event contract',
    primary: 'packages/app/jobs/journey-runtime.mjs',
    companion: 'packages/app/domain-journeys.mjs'
  },
  {
    id: 'integration_provider_contract',
    label: 'Integration provider contract and event handoff',
    primary: 'packages/app/integrations/ecommerce-provider.mjs',
    companion: 'packages/app/events/provider-events.mjs'
  },
  {
    id: 'analytics_rollup_pipeline',
    label: 'Analytics rollup pipeline and reporting store',
    primary: 'packages/app/analytics/rollup-pipeline.mjs',
    companion: 'packages/app/storage/reporting-store.mjs'
  },
  {
    id: 'security_audit_runtime',
    label: 'Security audit runtime and authorization handoff',
    primary: 'packages/app/security/audit-runtime.mjs',
    companion: 'packages/app/authz.mjs'
  },
  {
    id: 'template_editor_runtime',
    label: 'Template editor runtime and content block contract',
    primary: 'apps/web/routes/template-editor.mjs',
    companion: 'packages/app/templates/content-blocks.mjs'
  },
  {
    id: 'landing_page_builder_runtime',
    label: 'Landing page builder runtime and publish contract',
    primary: 'apps/web/routes/landing-page-builder.mjs',
    companion: 'packages/app/sites/publish-runtime.mjs'
  },
  {
    id: 'asset_library_runtime',
    label: 'Asset library runtime and media storage handoff',
    primary: 'packages/app/assets/library-runtime.mjs',
    companion: 'packages/app/storage/media-store.mjs'
  },
  {
    id: 'ecommerce_attribution_runtime',
    label: 'Ecommerce attribution runtime and revenue event contract',
    primary: 'packages/app/ecommerce/attribution-runtime.mjs',
    companion: 'packages/app/events/revenue-events.mjs'
  },
  {
    id: 'segmentation_query_runtime',
    label: 'Segmentation query runtime and audience index contract',
    primary: 'packages/app/segments/query-runtime.mjs',
    companion: 'packages/app/storage/audience-index.mjs'
  },
  {
    id: 'consent_privacy_runtime',
    label: 'Consent privacy runtime and suppression-list contract',
    primary: 'packages/app/privacy/consent-runtime.mjs',
    companion: 'packages/app/storage/suppression-store.mjs'
  },
  {
    id: 'billing_plan_runtime',
    label: 'Billing plan runtime and usage-metering contract',
    primary: 'packages/app/billing/plan-runtime.mjs',
    companion: 'packages/app/metering/usage-events.mjs'
  },
  {
    id: 'webhook_delivery_runtime',
    label: 'Webhook delivery runtime and retry queue contract',
    primary: 'packages/app/webhooks/delivery-runtime.mjs',
    companion: 'packages/app/jobs/webhook-retry-queue.mjs'
  },
  {
    id: 'content_personalization_runtime',
    label: 'Content personalization runtime and merge-tag contract',
    primary: 'packages/app/content/personalization-runtime.mjs',
    companion: 'packages/app/templates/merge-tags.mjs'
  },
  {
    id: 'ai_recommendation_contract',
    label: 'AI recommendation contract and provider mediation runtime',
    primary: 'packages/app/ai/recommendation-runtime.mjs',
    companion: 'packages/app/integrations/ai-provider.mjs'
  },
  {
    id: 'notification_preference_runtime',
    label: 'Notification preference runtime and channel policy contract',
    primary: 'packages/app/notifications/preference-runtime.mjs',
    companion: 'packages/app/policies/channel-policy.mjs'
  },
  {
    id: 'import_export_pipeline',
    label: 'Import export pipeline and contact normalization contract',
    primary: 'packages/app/import-export/pipeline-runtime.mjs',
    companion: 'packages/app/audience/contact-normalizer.mjs'
  },
  {
    id: 'experiment_ab_runtime',
    label: 'Experiment A/B runtime and variant assignment contract',
    primary: 'packages/app/experiments/ab-runtime.mjs',
    companion: 'packages/app/analytics/variant-events.mjs'
  },
  {
    id: 'observability_health_runtime',
    label: 'Observability health runtime and service heartbeat contract',
    primary: 'packages/app/observability/health-runtime.mjs',
    companion: 'packages/app/events/service-heartbeats.mjs'
  },
  {
    id: 'multi_account_runtime',
    label: 'Multi-account runtime and tenant membership contract',
    primary: 'packages/app/accounts/multi-account-runtime.mjs',
    companion: 'packages/app/storage/tenant-membership-store.mjs'
  },
  {
    id: 'role_permission_runtime',
    label: 'Role permission runtime and policy decision contract',
    primary: 'packages/app/security/role-permission-runtime.mjs',
    companion: 'packages/app/policies/permission-decisions.mjs'
  },
  {
    id: 'send_time_optimization_runtime',
    label: 'Send-time optimization runtime and recipient signal contract',
    primary: 'packages/app/delivery/send-time-optimization.mjs',
    companion: 'packages/app/analytics/recipient-signals.mjs'
  },
  {
    id: 'inbox_preview_runtime',
    label: 'Inbox preview runtime and rendering contract',
    primary: 'apps/web/routes/inbox-preview.mjs',
    companion: 'packages/app/rendering/email-preview-renderer.mjs'
  },
  {
    id: 'delivery_throttle_runtime',
    label: 'Delivery throttle runtime and queue budget contract',
    primary: 'packages/app/delivery/throttle-runtime.mjs',
    companion: 'packages/app/jobs/delivery-queue-budget.mjs'
  },
  {
    id: 'bounce_processing_runtime',
    label: 'Bounce processing runtime and suppression event contract',
    primary: 'packages/app/delivery/bounce-processing-runtime.mjs',
    companion: 'packages/app/events/suppression-events.mjs'
  },
  {
    id: 'survey_feedback_runtime',
    label: 'Survey feedback runtime and response aggregation contract',
    primary: 'packages/app/surveys/feedback-runtime.mjs',
    companion: 'packages/app/analytics/survey-response-aggregation.mjs'
  },
  {
    id: 'form_capture_runtime',
    label: 'Form capture runtime and lead-source contract',
    primary: 'apps/web/routes/form-capture.mjs',
    companion: 'packages/app/audience/lead-source-runtime.mjs'
  },
  {
    id: 'crm_note_runtime',
    label: 'CRM note runtime and contact timeline contract',
    primary: 'packages/app/crm/note-runtime.mjs',
    companion: 'packages/app/audience/contact-timeline.mjs'
  },
  {
    id: 'lifecycle_stage_runtime',
    label: 'Lifecycle stage runtime and automation trigger contract',
    primary: 'packages/app/audience/lifecycle-stage-runtime.mjs',
    companion: 'packages/app/events/automation-trigger-events.mjs'
  },
  {
    id: 'predictive_segment_runtime',
    label: 'Predictive segment runtime and scoring contract',
    primary: 'packages/app/segments/predictive-runtime.mjs',
    companion: 'packages/app/analytics/contact-scoring.mjs'
  },
  {
    id: 'compliance_export_runtime',
    label: 'Compliance export runtime and audit evidence contract',
    primary: 'packages/app/compliance/export-runtime.mjs',
    companion: 'packages/app/security/audit-evidence-store.mjs'
  },
  {
    id: 'brand_kit_runtime',
    label: 'Brand kit runtime and design token contract',
    primary: 'packages/app/brand/kit-runtime.mjs',
    companion: 'packages/app/templates/design-tokens.mjs'
  },
  {
    id: 'transactional_message_runtime',
    label: 'Transactional message runtime and event template contract',
    primary: 'packages/app/transactional/message-runtime.mjs',
    companion: 'packages/app/templates/event-template-store.mjs'
  },
  {
    id: 'journey_branching_runtime',
    label: 'Journey branching runtime and condition evaluator contract',
    primary: 'packages/app/journeys/branching-runtime.mjs',
    companion: 'packages/app/journeys/condition-evaluator.mjs'
  },
  {
    id: 'api_key_management_runtime',
    label: 'API key management runtime and token audit contract',
    primary: 'apps/web/routes/api-key-management.mjs',
    companion: 'packages/app/security/token-audit-log.mjs'
  },
  {
    id: 'data_warehouse_sync_runtime',
    label: 'Data warehouse sync runtime and batch checkpoint contract',
    primary: 'packages/app/warehouse/sync-runtime.mjs',
    companion: 'packages/app/storage/batch-checkpoint-store.mjs'
  },
  {
    id: 'marketplace_app_runtime',
    label: 'Marketplace app runtime and installation contract',
    primary: 'apps/web/routes/marketplace-apps.mjs',
    companion: 'packages/app/integrations/app-installation-store.mjs'
  },
  {
    id: 'social_posting_runtime',
    label: 'Social posting runtime and channel publish contract',
    primary: 'packages/app/social/posting-runtime.mjs',
    companion: 'packages/app/integrations/social-channel-provider.mjs'
  },
  {
    id: 'report_export_runtime',
    label: 'Report export runtime and file delivery contract',
    primary: 'packages/app/reports/export-runtime.mjs',
    companion: 'packages/app/storage/report-file-delivery.mjs'
  },
  {
    id: 'deliverability_reputation_runtime',
    label: 'Deliverability reputation runtime and sender score contract',
    primary: 'packages/app/deliverability/reputation-runtime.mjs',
    companion: 'packages/app/analytics/sender-score-events.mjs'
  },
  {
    id: 'domain_authentication_runtime',
    label: 'Domain authentication runtime and DNS verification contract',
    primary: 'packages/app/deliverability/domain-authentication-runtime.mjs',
    companion: 'packages/app/integrations/dns-verification-provider.mjs'
  },
  {
    id: 'customer_support_runtime',
    label: 'Customer support runtime and ticket timeline contract',
    primary: 'apps/web/routes/customer-support.mjs',
    companion: 'packages/app/support/ticket-timeline.mjs'
  },
  {
    id: 'onboarding_checklist_runtime',
    label: 'Onboarding checklist runtime and setup progress contract',
    primary: 'apps/web/routes/onboarding-checklist.mjs',
    companion: 'packages/app/accounts/setup-progress-store.mjs'
  },
  {
    id: 'plan_limit_enforcement_runtime',
    label: 'Plan limit enforcement runtime and quota decision contract',
    primary: 'packages/app/billing/plan-limit-runtime.mjs',
    companion: 'packages/app/metering/quota-decision-store.mjs'
  },
  {
    id: 'audit_search_runtime',
    label: 'Audit search runtime and evidence index contract',
    primary: 'packages/app/security/audit-search-runtime.mjs',
    companion: 'packages/app/storage/audit-index-store.mjs'
  },
  {
    id: 'mobile_push_runtime',
    label: 'Mobile push runtime and device token contract',
    primary: 'packages/app/mobile/push-runtime.mjs',
    companion: 'packages/app/storage/device-token-store.mjs'
  },
  {
    id: 'sms_campaign_runtime',
    label: 'SMS campaign runtime and provider dispatch contract',
    primary: 'packages/app/sms/campaign-runtime.mjs',
    companion: 'packages/app/integrations/sms-provider.mjs'
  },
  {
    id: 'in_app_message_runtime',
    label: 'In-app message runtime and audience delivery contract',
    primary: 'packages/app/messages/in-app-runtime.mjs',
    companion: 'packages/app/audience/delivery-audience-store.mjs'
  },
  {
    id: 'calendar_campaign_runtime',
    label: 'Calendar campaign runtime and scheduled send contract',
    primary: 'apps/web/routes/campaign-calendar.mjs',
    companion: 'packages/app/scheduling/scheduled-send-store.mjs'
  },
  {
    id: 'content_approval_runtime',
    label: 'Content approval runtime and reviewer decision contract',
    primary: 'packages/app/workflows/content-approval-runtime.mjs',
    companion: 'packages/app/storage/reviewer-decision-store.mjs'
  },
  {
    id: 'creative_asset_tagging_runtime',
    label: 'Creative asset tagging runtime and search facet contract',
    primary: 'packages/app/assets/tagging-runtime.mjs',
    companion: 'packages/app/search/asset-facet-index.mjs'
  },
  {
    id: 'template_versioning_runtime',
    label: 'Template versioning runtime and revision history contract',
    primary: 'packages/app/templates/versioning-runtime.mjs',
    companion: 'packages/app/storage/template-revision-store.mjs'
  },
  {
    id: 'email_rendering_runtime',
    label: 'Email rendering runtime and personalization context contract',
    primary: 'packages/app/rendering/email-rendering-runtime.mjs',
    companion: 'packages/app/content/personalization-context.mjs'
  },
  {
    id: 'journey_simulation_runtime',
    label: 'Journey simulation runtime and projected path contract',
    primary: 'packages/app/journeys/simulation-runtime.mjs',
    companion: 'packages/app/journeys/projected-path-store.mjs'
  },
  {
    id: 'automation_goal_runtime',
    label: 'Automation goal runtime and conversion tracking contract',
    primary: 'packages/app/automations/goal-runtime.mjs',
    companion: 'packages/app/analytics/conversion-events.mjs'
  },
  {
    id: 'coupon_code_runtime',
    label: 'Coupon code runtime and redemption contract',
    primary: 'packages/app/ecommerce/coupon-code-runtime.mjs',
    companion: 'packages/app/storage/redemption-store.mjs'
  },
  {
    id: 'recommendation_feed_runtime',
    label: 'Recommendation feed runtime and product catalog contract',
    primary: 'packages/app/recommendations/feed-runtime.mjs',
    companion: 'packages/app/ecommerce/product-catalog-store.mjs'
  },
  {
    id: 'customer_journey_map_runtime',
    label: 'Customer journey map runtime and touchpoint event contract',
    primary: 'apps/web/routes/customer-journey-map.mjs',
    companion: 'packages/app/events/touchpoint-events.mjs'
  },
  {
    id: 'revenue_forecast_runtime',
    label: 'Revenue forecast runtime and cohort projection contract',
    primary: 'packages/app/analytics/revenue-forecast-runtime.mjs',
    companion: 'packages/app/analytics/cohort-projection-store.mjs'
  },
  {
    id: 'list_hygiene_runtime',
    label: 'List hygiene runtime and contact quality contract',
    primary: 'packages/app/audience/list-hygiene-runtime.mjs',
    companion: 'packages/app/audience/contact-quality-store.mjs'
  },
  {
    id: 'preference_center_runtime',
    label: 'Preference center runtime and subscriber choice contract',
    primary: 'apps/web/routes/preference-center.mjs',
    companion: 'packages/app/privacy/subscriber-choice-store.mjs'
  },
  {
    id: 'campaign_archive_runtime',
    label: 'Campaign archive runtime and public permalink contract',
    primary: 'apps/web/routes/campaign-archive.mjs',
    companion: 'packages/app/storage/public-permalink-store.mjs'
  },
  {
    id: 'landing_page_ab_runtime',
    label: 'Landing page A/B runtime and visitor assignment contract',
    primary: 'packages/app/sites/landing-page-ab-runtime.mjs',
    companion: 'packages/app/experiments/visitor-assignment-store.mjs'
  },
  {
    id: 'form_spam_protection_runtime',
    label: 'Form spam protection runtime and risk score contract',
    primary: 'packages/app/forms/spam-protection-runtime.mjs',
    companion: 'packages/app/security/risk-score-store.mjs'
  },
  {
    id: 'contact_merge_runtime',
    label: 'Contact merge runtime and duplicate resolution contract',
    primary: 'packages/app/audience/contact-merge-runtime.mjs',
    companion: 'packages/app/storage/duplicate-resolution-store.mjs'
  },
  {
    id: 'account_activity_feed_runtime',
    label: 'Account activity feed runtime and event projection contract',
    primary: 'apps/web/routes/account-activity-feed.mjs',
    companion: 'packages/app/events/account-activity-events.mjs'
  },
  {
    id: 'data_retention_runtime',
    label: 'Data retention runtime and deletion job contract',
    primary: 'packages/app/privacy/data-retention-runtime.mjs',
    companion: 'packages/app/jobs/deletion-job-store.mjs'
  },
  {
    id: 'message_frequency_cap_runtime',
    label: 'Message frequency cap runtime and recipient cooldown contract',
    primary: 'packages/app/delivery/frequency-cap-runtime.mjs',
    companion: 'packages/app/storage/recipient-cooldown-store.mjs'
  },
  {
    id: 'send_window_runtime',
    label: 'Send window runtime and timezone policy contract',
    primary: 'packages/app/scheduling/send-window-runtime.mjs',
    companion: 'packages/app/policies/timezone-policy-store.mjs'
  },
  {
    id: 'bulk_action_runtime',
    label: 'Bulk action runtime and progress tracking contract',
    primary: 'packages/app/audience/bulk-action-runtime.mjs',
    companion: 'packages/app/jobs/bulk-progress-store.mjs'
  },
  {
    id: 'saved_view_runtime',
    label: 'Saved view runtime and filter snapshot contract',
    primary: 'apps/web/routes/saved-views.mjs',
    companion: 'packages/app/storage/filter-snapshot-store.mjs'
  },
  {
    id: 'dashboard_widget_runtime',
    label: 'Dashboard widget runtime and metric tile contract',
    primary: 'apps/web/routes/dashboard-widgets.mjs',
    companion: 'packages/app/analytics/metric-tile-store.mjs'
  },
  {
    id: 'workflow_template_runtime',
    label: 'Workflow template runtime and recipe instantiation contract',
    primary: 'packages/app/workflows/template-runtime.mjs',
    companion: 'packages/app/storage/recipe-instance-store.mjs'
  },
  {
    id: 'integration_oauth_runtime',
    label: 'Integration OAuth runtime and credential vault contract',
    primary: 'packages/app/integrations/oauth-runtime.mjs',
    companion: 'packages/app/security/credential-vault.mjs'
  },
  {
    id: 'partner_sync_runtime',
    label: 'Partner sync runtime and external account mapping contract',
    primary: 'packages/app/integrations/partner-sync-runtime.mjs',
    companion: 'packages/app/storage/external-account-map.mjs'
  },
  {
    id: 'data_quality_alert_runtime',
    label: 'Data quality alert runtime and anomaly notification contract',
    primary: 'packages/app/observability/data-quality-alert-runtime.mjs',
    companion: 'packages/app/notifications/anomaly-notification-store.mjs'
  },
  {
    id: 'incident_response_runtime',
    label: 'Incident response runtime and runbook event contract',
    primary: 'packages/app/observability/incident-response-runtime.mjs',
    companion: 'packages/app/events/runbook-events.mjs'
  },
  {
    id: 'feature_flag_runtime',
    label: 'Feature flag runtime and rollout decision contract',
    primary: 'packages/app/platform/feature-flag-runtime.mjs',
    companion: 'packages/app/policies/rollout-decision-store.mjs'
  },
  {
    id: 'tenant_migration_runtime',
    label: 'Tenant migration runtime and schema checkpoint contract',
    primary: 'packages/app/platform/tenant-migration-runtime.mjs',
    companion: 'packages/app/storage/schema-checkpoint-store.mjs'
  },
  {
    id: 'data_subject_request_runtime',
    label: 'Data subject request runtime and privacy evidence contract',
    primary: 'packages/app/privacy/data-subject-request-runtime.mjs',
    companion: 'packages/app/storage/privacy-evidence-store.mjs'
  },
  {
    id: 'suppression_import_runtime',
    label: 'Suppression import runtime and opt-out normalization contract',
    primary: 'packages/app/privacy/suppression-import-runtime.mjs',
    companion: 'packages/app/audience/opt-out-normalizer.mjs'
  },
  {
    id: 'campaign_budget_runtime',
    label: 'Campaign budget runtime and spend allocation contract',
    primary: 'packages/app/campaigns/budget-runtime.mjs',
    companion: 'packages/app/analytics/spend-allocation-store.mjs'
  },
  {
    id: 'attribution_model_runtime',
    label: 'Attribution model runtime and touch weighting contract',
    primary: 'packages/app/analytics/attribution-model-runtime.mjs',
    companion: 'packages/app/analytics/touch-weighting-store.mjs'
  },
  {
    id: 'conversion_goal_runtime',
    label: 'Conversion goal runtime and event matching contract',
    primary: 'packages/app/goals/conversion-goal-runtime.mjs',
    companion: 'packages/app/events/conversion-match-events.mjs'
  },
  {
    id: 'localized_content_runtime',
    label: 'Localized content runtime and locale fallback contract',
    primary: 'packages/app/content/localized-content-runtime.mjs',
    companion: 'packages/app/templates/locale-fallback-store.mjs'
  },
  {
    id: 'time_series_insights_runtime',
    label: 'Time-series insights runtime and anomaly baseline contract',
    primary: 'packages/app/analytics/time-series-insights-runtime.mjs',
    companion: 'packages/app/analytics/anomaly-baseline-store.mjs'
  },
  {
    id: 'predictive_send_frequency_runtime',
    label: 'Predictive send frequency runtime and fatigue score contract',
    primary: 'packages/app/delivery/predictive-frequency-runtime.mjs',
    companion: 'packages/app/analytics/fatigue-score-store.mjs'
  },
  {
    id: 'audience_growth_runtime',
    label: 'Audience growth runtime and acquisition source contract',
    primary: 'packages/app/audience/growth-runtime.mjs',
    companion: 'packages/app/analytics/acquisition-source-store.mjs'
  },
  {
    id: 'cross_channel_orchestration_runtime',
    label: 'Cross-channel orchestration runtime and channel handoff contract',
    primary: 'packages/app/orchestration/cross-channel-runtime.mjs',
    companion: 'packages/app/events/channel-handoff-events.mjs'
  },
  {
    id: 'partner_webhook_subscription_runtime',
    label: 'Partner webhook subscription runtime and endpoint verification contract',
    primary: 'packages/app/integrations/partner-webhook-subscription-runtime.mjs',
    companion: 'packages/app/security/webhook-endpoint-verification.mjs'
  },
  {
    id: 'sso_session_runtime',
    label: 'SSO session runtime and identity provider handoff contract',
    primary: 'packages/app/security/sso-session-runtime.mjs',
    companion: 'packages/app/integrations/identity-provider-handoff.mjs'
  },
  {
    id: 'custom_domain_runtime',
    label: 'Custom domain runtime and certificate provisioning contract',
    primary: 'apps/web/routes/custom-domains.mjs',
    companion: 'packages/app/integrations/certificate-provisioning-store.mjs'
  },
  {
    id: 'data_pipeline_backfill_runtime',
    label: 'Data pipeline backfill runtime and checkpoint replay contract',
    primary: 'packages/app/warehouse/backfill-runtime.mjs',
    companion: 'packages/app/storage/replay-checkpoint-store.mjs'
  },
  {
    id: 'real_time_segment_membership_runtime',
    label: 'Real-time segment membership runtime and stream cursor contract',
    primary: 'packages/app/segments/real-time-membership-runtime.mjs',
    companion: 'packages/app/events/stream-cursor-store.mjs'
  },
  {
    id: 'content_moderation_runtime',
    label: 'Content moderation runtime and policy finding contract',
    primary: 'packages/app/content/moderation-runtime.mjs',
    companion: 'packages/app/policies/policy-finding-store.mjs'
  },
  {
    id: 'template_marketplace_runtime',
    label: 'Template marketplace runtime and listing approval contract',
    primary: 'apps/web/routes/template-marketplace.mjs',
    companion: 'packages/app/templates/listing-approval-store.mjs'
  },
  {
    id: 'revenue_dashboard_runtime',
    label: 'Revenue dashboard runtime and KPI snapshot contract',
    primary: 'apps/web/routes/revenue-dashboard.mjs',
    companion: 'packages/app/analytics/kpi-snapshot-store.mjs'
  },
  {
    id: 'alert_subscription_runtime',
    label: 'Alert subscription runtime and delivery preference contract',
    primary: 'packages/app/notifications/alert-subscription-runtime.mjs',
    companion: 'packages/app/storage/alert-preference-store.mjs'
  },
  {
    id: 'app_extension_runtime',
    label: 'App extension runtime and embedded module contract',
    primary: 'packages/app/platform/app-extension-runtime.mjs',
    companion: 'packages/app/integrations/embedded-module-store.mjs'
  }
]);

function fixtureModuleSource(surface, role) {
  const exportName = `${role}Baseline_${surface.id.replace(/[^a-zA-Z0-9_$]/g, '_')}`;
  return `export const ${exportName}Contract = Object.freeze({
  surfaceId: ${JSON.stringify(surface.id)},
  role: ${JSON.stringify(role)},
  productArea: ${JSON.stringify(surface.label)},
  baseline: true
});

export function ${exportName}(input = {}) {
  const id = String(input.id || input.entityId || ${JSON.stringify(surface.id)});
  return {
    ok: true,
    surfaceId: ${JSON.stringify(surface.id)},
    role: ${JSON.stringify(role)},
    id,
    state: input.state || 'baseline_ready',
    contract: ${exportName}Contract
  };
}
`;
}

function materializeSemanticArchitectureFixtureRepo(repoPath) {
  for (const surface of SEMANTIC_ARCHITECTURE_SURFACES) {
    const primaryPath = path.join(repoPath, surface.primary);
    const companionPath = path.join(repoPath, surface.companion);
    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    fs.mkdirSync(path.dirname(companionPath), { recursive: true });
    if (!fs.existsSync(primaryPath)) fs.writeFileSync(primaryPath, fixtureModuleSource(surface, 'primary_runtime'));
    if (!fs.existsSync(companionPath)) fs.writeFileSync(companionPath, fixtureModuleSource(surface, 'companion_contract'));
  }
  fs.writeFileSync(path.join(repoPath, 'package.json'), `${JSON.stringify({ type: 'module', private: true, name: 'semantic-product-architecture-fixture' }, null, 2)}\n`);
}

function moduleSurface(id, label, filePath, verifierScriptPath) {
  return {
    id,
    label,
    allowedFiles: [filePath],
    verification: [`node ${verifierScriptPath} ${filePath}`]
  };
}

function enduranceScenarioCommand({ verifierScriptPath, scenarioId, durationMs, minCycles = 2 }) {
  return [
    `PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS="\${PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS_OVERRIDE:-${durationMs}}"`,
    `PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES="\${PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES_OVERRIDE:-${minCycles}}"`,
    'node',
    verifierScriptPath,
    scenarioId
  ].join(' ');
}

function functionalSurface(scenario, verifierScriptPath, options = {}) {
  return {
    id: scenario.id,
    label: scenario.label,
    allowedFiles: scenario.allowedFiles,
    verification: [enduranceScenarioCommand({
      verifierScriptPath,
      scenarioId: scenario.id,
      durationMs: Math.max(1, Number(options.durationMs || 1)),
      minCycles: Math.max(1, Number(options.minCycles || 2))
    })]
  };
}

function semanticArchitectureCommand({ verifierScriptPath, surface, durationMs = 1, minCycles = 1 }) {
  return [
    'node',
    verifierScriptPath,
    surface.id,
    '--file',
    surface.primary,
    '--companion',
    surface.companion,
    '--duration-ms',
    String(Math.max(0, Number(durationMs || 0))),
    '--min-cycles',
    String(Math.max(1, Number(minCycles || 1)))
  ].join(' ');
}

function semanticArchitectureSurface(surface, verifierScriptPath, options = {}) {
  return {
    id: surface.id,
    label: surface.label,
    allowedFiles: [surface.primary, surface.companion],
    verification: [semanticArchitectureCommand({
      verifierScriptPath,
      surface,
      durationMs: options.durationMs ?? 1,
      minCycles: options.minCycles ?? 1
    })]
  };
}

function pmhnpSiteSurface(surface, verifierScriptPath, options = {}) {
  const durationMs = Number(options.durationMs ?? 120 * 60 * 1000);
  const minCycles = Number(options.minCycles ?? 3);
  return {
    id: surface.id,
    label: surface.label,
    allowedFiles: [surface.file],
    verification: [
      `PMHNP_SITE_BENCHMARK_SURFACE_MIN_DURATION_MS="${'${PMHNP_SITE_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE:-'}${durationMs}}" PMHNP_SITE_BENCHMARK_SURFACE_MIN_CYCLES="${'${PMHNP_SITE_BENCHMARK_SURFACE_MIN_CYCLES_OVERRIDE:-'}${minCycles}}" PMHNP_SITE_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS="${'${PMHNP_SITE_BENCHMARK_SURFACE_CYCLE_INTERVAL_MS_OVERRIDE:-60000}'}" node ${verifierScriptPath} ${surface.id}`
    ],
    metadata: {
      brownfieldTransferRepo: 'pmhnpbilling-site',
      staticProductSurface: true,
      lowOverlapFile: surface.file,
      requiredCredit: 'static_product_surface_diff_plus_duration_verifier'
    }
  };
}

function waveAwareDurationTargetMinutes({ scenarioCount, requestedAgentCount, perWaveMinutes = 30, maxMinutes = null }) {
  const waves = Math.max(1, Math.ceil(Math.max(1, Number(scenarioCount || 0)) / Math.max(1, Number(requestedAgentCount || 1))));
  const durationMinutes = waves * perWaveMinutes;
  return maxMinutes == null ? durationMinutes : Math.min(maxMinutes, durationMinutes);
}

function buildPreset(name, stackRoot, options = {}) {
  const verifierScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-module-load.mjs');
  const tier2ScenarioScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-pmhnp-functional-scenario.mjs');
  const tier2CatalogScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-pmhnp-functional-catalog.mjs');
  const pmhnpSiteSurfaceScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-pmhnp-site-surface.mjs');
  const semanticArchitectureVerifierScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-semantic-architecture-surface.mjs');
  const gameSurfaceVerifierScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-godot-game-surface.mjs');
  const gameReadinessVerifierScriptPath = path.join(stackRoot, 'apps/system-benchmark/verify-game-100agent-readiness.mjs');
  const gameRepoPath = path.resolve(process.env.GAME_100_AGENT_REPO_PATH || options.gameRepoPath || '/root/clawd/maplestory-3d');
  const semanticRepoPath = path.join(options.artifactRoot || path.join(stackRoot, 'artifacts/benchmarks/semantic_product_architecture_smoke/manual'), 'repo');
  const semanticSurfaceDurationMs = Math.max(1, Number(process.env.SEMANTIC_ARCHITECTURE_PRESET_SURFACE_DURATION_MS || 1));
  const semanticSurfaceMinCycles = Math.max(1, Number(process.env.SEMANTIC_ARCHITECTURE_PRESET_MIN_CYCLES || 1));
  const semanticDurationTargetMinutes = Math.max(1, Number(process.env.SEMANTIC_ARCHITECTURE_PRESET_DURATION_TARGET_MINUTES || (semanticSurfaceDurationMs >= 30 * 60 * 1000 ? Math.ceil(semanticSurfaceDurationMs / 60000) : 15)));
  const tier1RequestedAgentCount = 10;
  const presets = {
    maplestory3d_100agent_readiness: {
      benchmarkId: 'maplestory3d_100agent_readiness',
      benchmarkTier: 'tier3_game_vertical_slice_100agent',
      benchmarkClass: 'greenfield_game_vertical_slice',
      fidelity: 'production_slice',
      repoPath: gameRepoPath,
      executionBoundary: 'remote_execution_required',
      requestedAgentCount: 100,
      notes: '100-agent game-readiness scaffold for a MapleStory-like 3D side-scrolling Godot vertical slice. This is a launch contract and gate set, not a claim that 100-agent quality convergence is already proven. Launch must happen on the remote execution plane with a real Godot repo, isolated worker workspaces, active Codex throttling, admission gates, game verifiers, and repair lane enabled.',
      replyAnchor: 'Jake replied to the 100-agent readiness ladder and said: “Implement all of this.”',
      scope: {
        durationTargetMinutes: 240,
        stopCondition: 'supervisor_green_or_blocker_report',
        surfaceReliability: {
          enabled: true,
          mode: 'tolerant_surface_reliability',
          greenMinVerifiedProductiveRatio: 0.95,
          yellowMinVerifiedProductiveRatio: 0.90,
          perfectVerifiedProductiveSurfaces: 100,
          maxToleratedFailedSurfaces: 5,
          requireClassifiedFailures: true,
          systemicFailureFails: true,
          note: '100/100 is a perfect-run badge; >=95/100 verified productive surfaces can be threshold-green when residual failures are classified and non-systemic.'
        },
        productDiffMode: 'creative_product_work',
        requireRealProductDiffs: true,
        requestedProduct: {
          type: 'maplestory_like_3d_side_scroller_vertical_slice',
          engine: 'godot',
          networkingScope: 'deferred_until_vertical_slice_is_green',
          mmoScope: 'explicitly_out_of_scope_for_first_100_agent_readiness_run'
        },
        creativeProductWork: {
          required: true,
          minIterations: 1,
          workerCommand: `node ${path.join(stackRoot, 'apps/system-benchmark/codex-creative-worker.mjs')}`,
          budgetRequired: true,
          requireBudgetLedger: true,
          repairExternalVerificationFailures: true,
          promptMode: 'compact'
        },
        realModelWork: { required: true, providerObservedUsageRequired: true },
        contextGovernor: {
          enabled: true,
          hardGate: true,
          maxWorkerTokens: 3200,
          workerPromptMode: 'compact',
          retrievalMode: 'on_demand_assigned_files_only',
          maxAllowedFiles: 4,
          maxFileAreas: 4,
          targetSavingsMin: 5
        },
        workerWorkspace: {
          mode: 'isolated_product_copy',
          copyPaths: ['project.godot', 'scripts', 'scenes', 'ui', 'assets', 'autoload', 'addons', 'tools', 'tests/headless'],
          promotion: 'admission_gated_promote_to_canonical_workspace'
        },
        schedulerPolicy: GAME_100_AGENT_SCHEDULER_POLICY,
        admissionGates: GAME_100_AGENT_ADMISSION_GATES,
        gameVerification: GAME_100_AGENT_VERIFICATION_POLICY,
        repairLane: GAME_100_AGENT_REPAIR_LANE,
        proofLadder: GAME_100_AGENT_READINESS_LADDER,
        canonicalLandingEvidence: {
          enabled: true,
          mode: 'block_on_failed_landing',
          minAddedLineCount: 8,
          minUniqueNormalizedAddedLineCount: 6,
          duplicateLineRatioMax: 0.35,
          duplicateLineCheckMinAddedLines: 12
        },
        proofCarryingClaims: {
          enabled: true,
          mode: 'require_adversarial_survival'
        },
        surfaces: buildGame100AgentReadinessSurfaces({ verifierScriptPath: gameSurfaceVerifierScriptPath })
      },
      verifierSet: [
        {
          kind: 'game_100agent_readiness_preflight',
          command: `node ${gameReadinessVerifierScriptPath} ${path.join(options.artifactRoot || '.', 'run_contract.json')} --launch`,
          purpose: 'Fail-closed preflight for remote execution boundary, 100-surface matrix, scheduler policy, admission gates, Godot verifier hooks, repair lane, and proof ladder.'
        },
        {
          kind: 'godot_game_surface',
          command: `node ${gameSurfaceVerifierScriptPath} --repo-path . --surface <surface-id> --file <assigned-product-file>`,
          purpose: 'Per-surface Godot/static verifier used by each game product shard.'
        }
      ]
    },
    semantic_product_architecture_smoke: {
      benchmarkId: 'semantic_product_architecture_smoke',
      benchmarkTier: 'tier1_smoke',
      benchmarkClass: 'semantic_product_architecture',
      fidelity: 'production_slice',
      repoPath: semanticRepoPath,
      executionBoundary: 'local_pipe_proof_then_remote_endurance',
      requestedAgentCount: SEMANTIC_ARCHITECTURE_SURFACES.length,
      notes: 'First semantic product-architecture transfer preset. Each shard must add executable runtime behavior to an isolated business-app product fixture and pass semantic admission; marker-only/source-syntax-only changes are not credited.',
      replyAnchor: 'Jake asked to start the real 100-agent product-architecture path after the 100-agent source/syntax product-diff rung passed.',
      semanticFixture: true,
      scope: {
        durationTargetMinutes: semanticDurationTargetMinutes,
        productDiffMode: 'semantic_product_architecture',
        requireSemanticProductAdmission: true,
        requireRealProductDiffs: true,
        semanticProductAdmission: {
          required: true,
          mode: 'semantic_product_architecture'
        },
        proofCarryingClaims: {
          enabled: true,
          mode: 'require_adversarial_survival'
        },
        canonicalLandingEvidence: {
          enabled: true,
          mode: 'block_on_failed_landing',
          minAddedLineCount: 30,
          minUniqueNormalizedAddedLineCount: 25,
          duplicateLineRatioMax: 0.35,
          duplicateLineCheckMinAddedLines: 20
        },
        surfaces: SEMANTIC_ARCHITECTURE_SURFACES.map((surface) => semanticArchitectureSurface(surface, semanticArchitectureVerifierScriptPath, {
          durationMs: semanticSurfaceDurationMs,
          minCycles: semanticSurfaceMinCycles
        }))
      },
      verifierSet: [
        {
          kind: 'semantic_architecture_surface',
          command: `node ${semanticArchitectureVerifierScriptPath}`,
          purpose: 'Per-surface verifier imports and executes generated semantic runtime exports against companion product contracts.'
        }
      ]
    },
    pmhnp_denial_copilot_transfer: {
      benchmarkId: 'pmhnp_denial_copilot_transfer',
      benchmarkTier: 'tier1_smoke',
      benchmarkClass: 'brownfield_product_transfer',
      fidelity: 'production_slice',
      repoPath: '/root/clawd/pmhnp-denial-copilot',
      executionBoundary: 'remote_execution_required',
      requestedAgentCount: tier1RequestedAgentCount,
      notes: 'Tier-1 endurance-capable transfer smoke benchmark for the PMHNP denial copilot. Each shard replays a real low-overlap functional workflow continuously for the declared window, so autonomy claims are tied to sustained verifier-backed execution rather than instant module loads. The runtime target is wave-aware so a 10-agent pool can finish the full scenario set honestly.',
      replyAnchor: 'Jake asked for the first actual transfer benchmark setup after defining the orchestration benchmark program, then asked to keep going until we got a good result.',
      scope: {
        durationTargetMinutes: waveAwareDurationTargetMinutes({
          scenarioCount: PMHNP_TIER2_SCENARIOS.length,
          requestedAgentCount: tier1RequestedAgentCount
        }),
        surfaces: PMHNP_TIER2_SCENARIOS.map((scenario) => functionalSurface(scenario, tier2ScenarioScriptPath, {
          durationMs: 30 * 60 * 1000,
          minCycles: 2
        }))
      },
      verifierSet: [
        {
          kind: 'node_script',
          command: 'node scripts/smoke-test.mjs',
          purpose: 'Whole-runtime smoke proof that the PMHNP denial copilot still boots and serves key flows.'
        },
        {
          kind: 'functional_catalog',
          command: `node ${tier2CatalogScriptPath}`,
          purpose: 'One-pass proof that the full PMHNP functional scenario catalog is runnable before endurance benchmarking.'
        }
      ]
    },
    pmhnp_denial_copilot_transfer_tier2: {
      benchmarkId: 'pmhnp_denial_copilot_transfer_tier2',
      benchmarkTier: 'tier2_functional',
      benchmarkClass: 'brownfield_product_transfer',
      fidelity: 'production_slice',
      repoPath: '/root/clawd/pmhnp-denial-copilot',
      executionBoundary: 'remote_execution_required',
      requestedAgentCount: 10,
      notes: 'Tier-2 endurance transfer benchmark for the PMHNP denial copilot. Each shard continuously replays one real workflow against a low-overlap surface, so long-window autonomy claims reflect sustained functional execution on the transfer repo. The wall-clock runtime target is wave-aware so a 10-agent pool can finish the full scenario set honestly.',
      replyAnchor: 'Jake asked to turn the PMHNP benchmark into a stronger tier2 functional transfer benchmark after the tier1 smoke benchmark passed.',
      scope: {
        durationTargetMinutes: waveAwareDurationTargetMinutes({
          scenarioCount: PMHNP_TIER2_SCENARIOS.length,
          requestedAgentCount: 10,
          perWaveMinutes: 120
        }),
        surfaces: PMHNP_TIER2_SCENARIOS.map((scenario) => functionalSurface(scenario, tier2ScenarioScriptPath, {
          durationMs: 120 * 60 * 1000,
          minCycles: 3
        }))
      },
      verifierSet: [
        {
          kind: 'node_script',
          command: 'node scripts/smoke-test.mjs',
          purpose: 'Whole-runtime smoke proof that the PMHNP denial copilot still boots and serves key flows.'
        },
        {
          kind: 'functional_catalog',
          command: `node ${tier2CatalogScriptPath}`,
          purpose: 'Serial proof that the full tier2 functional scenario catalog is runnable before concurrency benchmarking.'
        }
      ]
    },
    pmhnp_billing_site_tier2_25agent_120m: {
      benchmarkId: 'pmhnp_billing_site_tier2_25agent_120m',
      benchmarkTier: 'tier2_functional',
      benchmarkClass: 'brownfield_product_transfer',
      fidelity: 'production_slice',
      repoPath: '/root/clawd/pmhnpbilling-site',
      executionBoundary: 'remote_execution_required',
      requestedAgentCount: 25,
      notes: 'B2 Tier2 brownfield product transfer on the primary PMHNP billing site candidate: 25 low-overlap static product surfaces, 25 workers, 120-minute verifier-backed window, canonical landed product diffs required. This closes the remaining Tier2 B2 scale gap if threshold-green.',
      replyAnchor: 'Jake said “Okay let’s continue toward that goal” after confirming the agent orchestration goal and the remaining Tier2 gap: B2 brownfield transfer at 25-agent scale.',
      scope: {
        durationTargetMinutes: 120,
        productDiffMode: 'deterministic_metadata_patch',
        requireRealProductDiffs: true,
        canonicalLandingEvidence: {
          enabled: true,
          mode: 'block_on_failed_landing'
        },
        surfaces: PMHNP_SITE_TIER2_SURFACES.map((surface) => pmhnpSiteSurface(surface, pmhnpSiteSurfaceScriptPath, {
          durationMs: 120 * 60 * 1000,
          minCycles: 3
        }))
      },
      verifierSet: [
        {
          kind: 'static_site_surface_endurance',
          command: `node ${pmhnpSiteSurfaceScriptPath}`,
          purpose: 'Each shard continuously validates one low-overlap PMHNP billing site product surface for the declared Tier2 window.'
        }
      ]
    }
  };
  return presets[name] || null;
}

const presetName = process.argv[2] || 'pmhnp_denial_copilot_transfer';
const stackRoot = path.resolve(process.argv[3] || process.env.CLAWD_STACK_ROOT || process.cwd());
const artifactStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const provisionalArtifactRoot = path.join(stackRoot, 'artifacts/benchmarks', presetName, `bootstrap-${artifactStamp}`);
const preset = buildPreset(presetName, stackRoot, { artifactRoot: provisionalArtifactRoot });
if (!preset) {
  console.error(`Unknown preset: ${presetName}`);
  console.error('Available presets: maplestory3d_100agent_readiness, semantic_product_architecture_smoke, pmhnp_denial_copilot_transfer, pmhnp_denial_copilot_transfer_tier2, pmhnp_billing_site_tier2_25agent_120m');
  process.exit(1);
}
const scoreboardPath = path.join(stackRoot, 'artifacts/benchmarks/scoreboard.json');
const artifactRoot = preset.benchmarkId === presetName
  ? provisionalArtifactRoot
  : path.join(stackRoot, 'artifacts/benchmarks', preset.benchmarkId, `bootstrap-${artifactStamp}`);
const templatePath = path.join(stackRoot, 'apps/system-benchmark/templates/benchmark-run-contract.template.json');

if (preset.semanticFixture) {
  materializeSemanticArchitectureFixtureRepo(preset.repoPath);
}

fs.mkdirSync(path.dirname(templatePath), { recursive: true });
if (!fs.existsSync(templatePath)) {
  fs.writeFileSync(templatePath, `${JSON.stringify(benchmarkRunContractTemplate(), null, 2)}\n`);
}

const scaffold = bootstrapTransferBenchmark({
  ...preset,
  artifactRoot,
  scoreboardPath
});

upsertBenchmarkScoreboardRow({
  scoreboardPath,
  row: scaffold.scoreboardRow
});

const summaryPath = path.join(scaffold.root, 'README.md');
fs.writeFileSync(summaryPath, `# ${preset.benchmarkId}\n\n- Repo: ${preset.repoPath}\n- Tier: ${preset.benchmarkTier}\n- Fidelity: ${preset.fidelity}\n- Run id: ${scaffold.contract.runId}\n- Scoreboard: ${scoreboardPath}\n- Template: ${templatePath}\n\nThis is a prepared transfer benchmark scaffold. Execute the declared verifier(s), then update the scoreboard row with real benchmark results.\n`);

console.log(JSON.stringify({
  ok: true,
  preset: presetName,
  artifactRoot: scaffold.root,
  runContractPath: path.join(scaffold.root, 'run_contract.json'),
  surfaceMatrixPath: path.join(scaffold.root, 'surface_matrix.json'),
  scoreboardPath,
  scoreboardRowPath: path.join(scaffold.root, 'scoreboard_row.json'),
  templatePath,
  runId: scaffold.contract.runId
}, null, 2));
