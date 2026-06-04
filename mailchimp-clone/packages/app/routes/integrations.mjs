import { registerIntegrationsMarketplaceRoutes } from './integrations-marketplace.mjs';
import { connectorJourneyMap, customJourneyIntegrationSummary } from '../domain-custom-journeys.mjs';
import { page } from '../view.mjs';
import { escapeHtml, text } from '../utils.mjs';

export function registerIntegrationRoutes(router, deps) {
  registerIntegrationsMarketplaceRoutes(router, deps);
  const { requireAuth } = deps;

  router.register('GET', '/integrations/journey-map', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const summary = customJourneyIntegrationSummary(state, actor.workspace.id);
    const rows = connectorJourneyMap(state, actor.workspace.id);
    const lifecycle = summary.lifecycle || {};
    const syncControls = summary.syncControls || {};
    text(res, 200, page('Integration journey map', actor, `<div class="grid"><div class="card"><h3>Connector handoff summary</h3><p>Installations: ${summary.installations} · active: ${summary.activeInstallations}</p><p>Webhooks: ${summary.webhooks} · active: ${summary.activeWebhooks}</p><p>Journey handoffs: ${summary.journeyHandoffs}</p><p>Next action: ${escapeHtml(summary.nextLifecycleAction || 'Monitor active sync health')}</p></div><div class="card"><h3>Lifecycle health</h3><p>Connected: ${lifecycle.connected || 0} · pending auth: ${lifecycle.pendingAuth || 0} · settings needed: ${lifecycle.needsSettings || 0}</p><p>Blocked: ${lifecycle.blocked || 0} · disconnected: ${lifecycle.disconnected || 0}</p><p>Sync running: ${syncControls.running || 0} · paused: ${syncControls.paused || 0} · manual sync ready: ${syncControls.manualSyncAvailable || 0}</p></div><div class="card"><h3>Connector families</h3><p>${summary.connectorFamilies.map(escapeHtml).join(', ') || 'No connectors installed yet.'}</p><p><a href="/integrations">Open marketplace</a></p></div></div><div class="card"><table><tr><th>Provider</th><th>Status</th><th>Auth</th><th>Sync</th><th>Health</th><th>Mapped journeys</th></tr>${rows.map((row) => `<tr><td>${escapeHtml(row.provider || 'unknown')}</td><td>${escapeHtml(row.status || 'draft')}</td><td>${escapeHtml(row.authStatus || 'ok')}</td><td>${escapeHtml(row.syncStatus || 'not_ready')}${row.lastSyncAt ? `<br><small>Last sync: ${escapeHtml(row.lastSyncAt)}</small>` : ''}</td><td>${escapeHtml(row.health || 'Not connected')}<br><small>${escapeHtml(row.nextAction || 'Review sync')}</small></td><td>${row.mappedJourneys.map((journey) => `${escapeHtml(journey.name)} (${escapeHtml(journey.trigger)})`).join('<br>') || 'No journey handoff yet'}</td></tr>`).join('') || '<tr><td colspan="6">No connector map yet.</td></tr>'}</table></div>`));
  });
}

function evaluatePrimaryRuntimeAdoption(config, state = {}, actor = {}, input = {}) {
  const workspaceId = actor?.workspace?.id || actor?.workspaceId || input.workspaceId || 'workspace';
  const db = state.db || {};
  const now = input.now || new Date().toISOString();
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !['completed', 'failed', 'cancelled'].includes(entry.status) && (!entry.workspaceId || entry.workspaceId === workspaceId)) : [];
  const events = Array.isArray(db.auditEvents) ? db.auditEvents.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).slice(0, 5) : [];
  const workflowSignals = (config.workflowSignals || []).map((signal, index) => ({ id: signal, status: input.completedSignals?.includes?.(signal) ? 'complete' : index === 0 ? 'active' : 'pending', requestScoped: true, recoverable: signal.includes('recovery') || signal.includes('handoff') }));
  return {
    ...config,
    workspaceId,
    generatedAt: now,
    counters: { campaigns: campaigns.length, contacts: contacts.length, activeJobs: jobs.length, auditEvents: events.length },
    workflowSignals,
    nextAction: jobs.length > 0 ? 'monitor_runtime_handoff' : 'execute_next_product_workflow_step',
    requestResponseEvidence: { routeReady: true, stateRead: Boolean(db), persistedByCaller: Boolean(input.persistedByCaller), recoveryPath: workflowSignals.some((signal) => signal.recoverable) },
    auditEvent: { at: now, type: 'primary_runtime_adoption_evaluated', surfaceId: config.surfaceId, phaseId: config.phaseId, shardId: config.shardId }
  };
}


export function buildIntegrationsMarketplaceContinuationWave001ClientAppRuntimeAdoptionPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_client_app_runtime_adoption","phaseTitle":"continuation wave 001 — client application runtime adoption slice","shardId":"focus.integrations_marketplace::continuation-001#1#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001BrowserEvidenceAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_browser_evidence_acceptance_runtime","phaseTitle":"continuation wave 001 — browser evidence and acceptance runtime slice","shardId":"focus.integrations_marketplace::continuation-001#10#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001MultiTenantWorkspaceBoundariesPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_multi_tenant_workspace_boundaries","phaseTitle":"continuation wave 001 — multi-tenant workspace boundary slice","shardId":"focus.integrations_marketplace::continuation-001#11#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["workspace_scope","role_boundary","tenant_isolation","audit_handoff","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ServiceBackedProviderContractsPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_service_backed_provider_contracts","phaseTitle":"continuation wave 001 — service-backed provider contract slice","shardId":"focus.integrations_marketplace::continuation-001#12#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["runtime_state","workflow_command","audit_event","recovery","next_action"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001AssetRenderingPipelineRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_asset_rendering_pipeline_runtime","phaseTitle":"continuation wave 001 — asset rendering and delivery pipeline slice","shardId":"focus.integrations_marketplace::continuation-001#13#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001WorkflowApprovalLifecycleRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_workflow_approval_lifecycle_runtime","phaseTitle":"continuation wave 001 — workflow approval and lifecycle slice","shardId":"focus.integrations_marketplace::continuation-001#14#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["draft","review","approval","publish","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001DataPrivacyComplianceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_data_privacy_compliance_runtime","phaseTitle":"continuation wave 001 — data privacy and compliance runtime slice","shardId":"focus.integrations_marketplace::continuation-001#15#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ObservabilitySlaRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_observability_sla_runtime","phaseTitle":"continuation wave 001 — observability and SLA runtime slice","shardId":"focus.integrations_marketplace::continuation-001#16#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ImportExportMigrationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_import_export_migration_runtime","phaseTitle":"continuation wave 001 — import/export and migration runtime slice","shardId":"focus.integrations_marketplace::continuation-001#17#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ExperimentationOptimizationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_experimentation_optimization_runtime","phaseTitle":"continuation wave 001 — experimentation and optimization runtime slice","shardId":"focus.integrations_marketplace::continuation-001#18#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001RealtimeCollaborationPresenceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_realtime_collaboration_presence_runtime","phaseTitle":"continuation wave 001 — real-time collaboration and presence slice","shardId":"focus.integrations_marketplace::continuation-001#19#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001EditorInteractionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_editor_interaction_runtime","phaseTitle":"continuation wave 001 — editor interaction runtime slice","shardId":"focus.integrations_marketplace::continuation-001#2#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001BillingEntitlementUsageRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_billing_entitlement_usage_runtime","phaseTitle":"continuation wave 001 — billing entitlement and usage runtime slice","shardId":"focus.integrations_marketplace::continuation-001#20#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ApiRateLimitWebhookDeliveryRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_api_rate_limit_webhook_delivery_runtime","phaseTitle":"continuation wave 001 — API rate-limit and webhook delivery slice","shardId":"focus.integrations_marketplace::continuation-001#21#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001NegativeSpaceParityAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_negative_space_parity_acceptance_runtime","phaseTitle":"continuation wave 001 — negative-space parity acceptance slice","shardId":"focus.integrations_marketplace::continuation-001#22#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001EnterpriseAccountGovernanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_enterprise_account_governance_runtime","phaseTitle":"continuation wave 001 — enterprise account governance runtime slice","shardId":"focus.integrations_marketplace::continuation-001#23#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001DataResidencyRetentionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_data_residency_retention_runtime","phaseTitle":"continuation wave 001 — data residency and retention runtime slice","shardId":"focus.integrations_marketplace::continuation-001#24#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ConsentPreferenceCenterRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_consent_preference_center_runtime","phaseTitle":"continuation wave 001 — consent and preference-center runtime slice","shardId":"focus.integrations_marketplace::continuation-001#25#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001DeliverabilityReputationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_deliverability_reputation_runtime","phaseTitle":"continuation wave 001 — deliverability and reputation runtime slice","shardId":"focus.integrations_marketplace::continuation-001#26#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001TemplateVersioningLocalizationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_template_versioning_localization_runtime","phaseTitle":"continuation wave 001 — template versioning and localization runtime slice","shardId":"focus.integrations_marketplace::continuation-001#27#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001AudienceDedupIdentityResolutionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_audience_dedup_identity_resolution_runtime","phaseTitle":"continuation wave 001 — audience deduplication and identity-resolution slice","shardId":"focus.integrations_marketplace::continuation-001#28#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001JourneyBackfillReplayRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_journey_backfill_replay_runtime","phaseTitle":"continuation wave 001 — journey backfill and replay runtime slice","shardId":"focus.integrations_marketplace::continuation-001#29#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001DatabaseTransactionModelPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_database_transaction_model","phaseTitle":"continuation wave 001 — database transaction and concurrency slice","shardId":"focus.integrations_marketplace::continuation-001#3#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["runtime_state","workflow_command","audit_event","recovery","next_action"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001CrossChannelAttributionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_cross_channel_attribution_runtime","phaseTitle":"continuation wave 001 — cross-channel attribution runtime slice","shardId":"focus.integrations_marketplace::continuation-001#30#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001MarketplaceAppReviewRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_marketplace_app_review_runtime","phaseTitle":"continuation wave 001 — marketplace app review and installation runtime slice","shardId":"focus.integrations_marketplace::continuation-001#31#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["draft","review","approval","publish","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001IncidentResponseAdminRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_incident_response_admin_runtime","phaseTitle":"continuation wave 001 — incident response and admin runtime slice","shardId":"focus.integrations_marketplace::continuation-001#32#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001PerformanceAccessibilityBudgetRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_performance_accessibility_budget_runtime","phaseTitle":"continuation wave 001 — performance and accessibility budget runtime slice","shardId":"focus.integrations_marketplace::continuation-001#33#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001FullStackParityEvidenceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_full_stack_parity_evidence_runtime","phaseTitle":"continuation wave 001 — full-stack parity evidence runtime slice","shardId":"focus.integrations_marketplace::continuation-001#34#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ReadModelProjectionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_read_model_projection_runtime","phaseTitle":"continuation wave 001 — read model projection runtime slice","shardId":"focus.integrations_marketplace::continuation-001#4#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001ExternalOauthProviderRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_external_oauth_provider_runtime","phaseTitle":"continuation wave 001 — external OAuth/provider runtime slice","shardId":"focus.integrations_marketplace::continuation-001#5#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001DeliveryQueueWorkerRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_delivery_queue_worker_runtime","phaseTitle":"continuation wave 001 — delivery queue and worker runtime slice","shardId":"focus.integrations_marketplace::continuation-001#6#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001AnalyticsEventStreamRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_analytics_event_stream_runtime","phaseTitle":"continuation wave 001 — analytics event stream runtime slice","shardId":"focus.integrations_marketplace::continuation-001#7#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001SecurityGovernanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_security_governance_runtime","phaseTitle":"continuation wave 001 — security governance runtime slice","shardId":"focus.integrations_marketplace::continuation-001#8#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildIntegrationsMarketplaceContinuationWave001SupportRecoveryRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"integrations_marketplace","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_support_recovery_runtime","phaseTitle":"continuation wave 001 — support recovery and admin control slice","shardId":"focus.integrations_marketplace::continuation-001#9#1","targetFile":"packages/app/routes/integrations.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}
