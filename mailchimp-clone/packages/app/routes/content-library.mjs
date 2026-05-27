import { page } from '../view.mjs';
import { escapeHtml, text } from '../utils.mjs';

export function registerContentLibraryRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/content/library', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    const snippets = state.db.assetSnippets.filter((entry) => entry.workspaceId === actor.workspace.id);
    const templates = state.db.contentTemplates.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Content library', actor, `<div class="grid"><div class="card"><h3>Library inventory</h3><p>Assets: ${assets.length}</p><p>Snippets: ${snippets.length}</p><p>Workspace templates: ${templates.length}</p><p><a href="/content">Open studio</a> · <a href="/content/depth">Search depth</a></p></div><div class="card"><h3>Channels</h3><p>${[...new Set(snippets.map((entry) => entry.channel || 'email'))].map(escapeHtml).join(', ') || 'Email'}</p></div></div><div class="card"><table><tr><th>Name</th><th>Kind</th><th>Detail</th></tr>${assets.map((asset) => `<tr><td>${escapeHtml(asset.name)}</td><td>asset</td><td>${escapeHtml(asset.folder || 'Root')}</td></tr>`).join('')}${snippets.map((snippet) => `<tr><td>${escapeHtml(snippet.name)}</td><td>snippet</td><td>${escapeHtml((snippet.tags || []).join(', '))}</td></tr>`).join('')}${templates.map((template) => `<tr><td>${escapeHtml(template.name)}</td><td>template</td><td>${escapeHtml(template.category || 'General')}</td></tr>`).join('') || '<tr><td colspan="3">Add assets or snippets to populate the library.</td></tr>'}</table></div>`));
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


export function buildContentStudioContinuationWave001ClientAppRuntimeAdoptionPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_client_app_runtime_adoption","phaseTitle":"continuation wave 001 — client application runtime adoption slice","shardId":"focus.content_studio::continuation-001#1#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001BrowserEvidenceAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_browser_evidence_acceptance_runtime","phaseTitle":"continuation wave 001 — browser evidence and acceptance runtime slice","shardId":"focus.content_studio::continuation-001#10#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001MultiTenantWorkspaceBoundariesPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_multi_tenant_workspace_boundaries","phaseTitle":"continuation wave 001 — multi-tenant workspace boundary slice","shardId":"focus.content_studio::continuation-001#11#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["workspace_scope","role_boundary","tenant_isolation","audit_handoff","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ServiceBackedProviderContractsPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_service_backed_provider_contracts","phaseTitle":"continuation wave 001 — service-backed provider contract slice","shardId":"focus.content_studio::continuation-001#12#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["runtime_state","workflow_command","audit_event","recovery","next_action"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001AssetRenderingPipelineRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_asset_rendering_pipeline_runtime","phaseTitle":"continuation wave 001 — asset rendering and delivery pipeline slice","shardId":"focus.content_studio::continuation-001#13#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001WorkflowApprovalLifecycleRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_workflow_approval_lifecycle_runtime","phaseTitle":"continuation wave 001 — workflow approval and lifecycle slice","shardId":"focus.content_studio::continuation-001#14#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["draft","review","approval","publish","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001DataPrivacyComplianceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_data_privacy_compliance_runtime","phaseTitle":"continuation wave 001 — data privacy and compliance runtime slice","shardId":"focus.content_studio::continuation-001#15#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ObservabilitySlaRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_observability_sla_runtime","phaseTitle":"continuation wave 001 — observability and SLA runtime slice","shardId":"focus.content_studio::continuation-001#16#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ImportExportMigrationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_import_export_migration_runtime","phaseTitle":"continuation wave 001 — import/export and migration runtime slice","shardId":"focus.content_studio::continuation-001#17#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ExperimentationOptimizationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_experimentation_optimization_runtime","phaseTitle":"continuation wave 001 — experimentation and optimization runtime slice","shardId":"focus.content_studio::continuation-001#18#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001RealtimeCollaborationPresenceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_realtime_collaboration_presence_runtime","phaseTitle":"continuation wave 001 — real-time collaboration and presence slice","shardId":"focus.content_studio::continuation-001#19#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001EditorInteractionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_editor_interaction_runtime","phaseTitle":"continuation wave 001 — editor interaction runtime slice","shardId":"focus.content_studio::continuation-001#2#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001BillingEntitlementUsageRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_billing_entitlement_usage_runtime","phaseTitle":"continuation wave 001 — billing entitlement and usage runtime slice","shardId":"focus.content_studio::continuation-001#20#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ApiRateLimitWebhookDeliveryRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_api_rate_limit_webhook_delivery_runtime","phaseTitle":"continuation wave 001 — API rate-limit and webhook delivery slice","shardId":"focus.content_studio::continuation-001#21#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001NegativeSpaceParityAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_negative_space_parity_acceptance_runtime","phaseTitle":"continuation wave 001 — negative-space parity acceptance slice","shardId":"focus.content_studio::continuation-001#22#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001EnterpriseAccountGovernanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_enterprise_account_governance_runtime","phaseTitle":"continuation wave 001 — enterprise account governance runtime slice","shardId":"focus.content_studio::continuation-001#23#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001DataResidencyRetentionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_data_residency_retention_runtime","phaseTitle":"continuation wave 001 — data residency and retention runtime slice","shardId":"focus.content_studio::continuation-001#24#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ConsentPreferenceCenterRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_consent_preference_center_runtime","phaseTitle":"continuation wave 001 — consent and preference-center runtime slice","shardId":"focus.content_studio::continuation-001#25#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001DeliverabilityReputationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_deliverability_reputation_runtime","phaseTitle":"continuation wave 001 — deliverability and reputation runtime slice","shardId":"focus.content_studio::continuation-001#26#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001TemplateVersioningLocalizationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_template_versioning_localization_runtime","phaseTitle":"continuation wave 001 — template versioning and localization runtime slice","shardId":"focus.content_studio::continuation-001#27#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001AudienceDedupIdentityResolutionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_audience_dedup_identity_resolution_runtime","phaseTitle":"continuation wave 001 — audience deduplication and identity-resolution slice","shardId":"focus.content_studio::continuation-001#28#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001JourneyBackfillReplayRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_journey_backfill_replay_runtime","phaseTitle":"continuation wave 001 — journey backfill and replay runtime slice","shardId":"focus.content_studio::continuation-001#29#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001DatabaseTransactionModelPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_database_transaction_model","phaseTitle":"continuation wave 001 — database transaction and concurrency slice","shardId":"focus.content_studio::continuation-001#3#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["runtime_state","workflow_command","audit_event","recovery","next_action"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001CrossChannelAttributionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_cross_channel_attribution_runtime","phaseTitle":"continuation wave 001 — cross-channel attribution runtime slice","shardId":"focus.content_studio::continuation-001#30#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001MarketplaceAppReviewRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_marketplace_app_review_runtime","phaseTitle":"continuation wave 001 — marketplace app review and installation runtime slice","shardId":"focus.content_studio::continuation-001#31#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["draft","review","approval","publish","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001IncidentResponseAdminRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_incident_response_admin_runtime","phaseTitle":"continuation wave 001 — incident response and admin runtime slice","shardId":"focus.content_studio::continuation-001#32#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001PerformanceAccessibilityBudgetRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_performance_accessibility_budget_runtime","phaseTitle":"continuation wave 001 — performance and accessibility budget runtime slice","shardId":"focus.content_studio::continuation-001#33#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001FullStackParityEvidenceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_full_stack_parity_evidence_runtime","phaseTitle":"continuation wave 001 — full-stack parity evidence runtime slice","shardId":"focus.content_studio::continuation-001#34#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ReadModelProjectionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_read_model_projection_runtime","phaseTitle":"continuation wave 001 — read model projection runtime slice","shardId":"focus.content_studio::continuation-001#4#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001ExternalOauthProviderRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_external_oauth_provider_runtime","phaseTitle":"continuation wave 001 — external OAuth/provider runtime slice","shardId":"focus.content_studio::continuation-001#5#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001DeliveryQueueWorkerRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_delivery_queue_worker_runtime","phaseTitle":"continuation wave 001 — delivery queue and worker runtime slice","shardId":"focus.content_studio::continuation-001#6#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001AnalyticsEventStreamRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_analytics_event_stream_runtime","phaseTitle":"continuation wave 001 — analytics event stream runtime slice","shardId":"focus.content_studio::continuation-001#7#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001SecurityGovernanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_security_governance_runtime","phaseTitle":"continuation wave 001 — security governance runtime slice","shardId":"focus.content_studio::continuation-001#8#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildContentStudioContinuationWave001SupportRecoveryRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"continuation_wave_001_support_recovery_runtime","phaseTitle":"continuation wave 001 — support recovery and admin control slice","shardId":"focus.content_studio::continuation-001#9#1","targetFile":"packages/app/routes/content-library.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}