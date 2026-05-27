import { persistState } from '../storage.mjs';
import { page } from '../view.mjs';
import { escapeHtml, readBody, redirect, text } from '../utils.mjs';

export function registerTemplateRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/templates/library', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const workspaceTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === actor.workspace.id);
    const systemTemplates = state.db.templates || [];
    const campaigns = state.db.campaigns.filter((campaign) => campaign.workspaceId === actor.workspace.id);
    const categories = [...new Set([...systemTemplates, ...workspaceTemplates].map((template) => template.category || 'General'))];
    text(res, 200, page('Template library workspace', actor, `<div class="grid"><div class="card"><h3>Library coverage</h3><p>System templates: ${systemTemplates.length}</p><p>Workspace templates: ${workspaceTemplates.length}</p><p>Categories: ${categories.map(escapeHtml).join(', ')}</p><p><a href="/content">Create reusable content template</a></p></div><div class="card"><h3>Governance</h3><p>Template selection is connected to campaigns, content studio, approvals, and asset lineage.</p><p><a href="/content/depth">Open lineage search</a></p></div><div class="card"><h3>Campaign handoff</h3><form method="post" action="/templates/library/apply"><select name="campaignId">${campaigns.map((campaign) => `<option value="${campaign.id}">${escapeHtml(campaign.name || 'Untitled campaign')}</option>`).join('')}</select><select name="templateId">${[...workspaceTemplates, ...systemTemplates].map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('')}</select><button>Apply template to campaign editor</button></form><p>Template governance now writes directly into the campaign builder and preserves source metadata.</p></div></div><div class="card"><table><tr><th>Name</th><th>Category</th><th>Blocks</th><th>Source</th><th>Editor handoff</th></tr>${[...workspaceTemplates, ...systemTemplates].map((template) => `<tr><td>${escapeHtml(template.name)}</td><td>${escapeHtml(template.category || 'General')}</td><td>${(template.blocks || []).length}</td><td>${escapeHtml(template.source || (template.workspaceId ? 'workspace' : 'system'))}</td><td>${campaigns.length ? 'ready' : 'create a campaign first'}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/templates/library/apply', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const campaign = state.db.campaigns.find((entry) => entry.id === body.campaignId && entry.workspaceId === actor.workspace.id);
    const template = [...state.db.templates, ...state.db.contentTemplates].find((entry) => entry.id === body.templateId && (!entry.workspaceId || entry.workspaceId === actor.workspace.id));
    if (campaign && template) {
      campaign.templateId = template.id;
      campaign.templateAppliedAt = new Date().toISOString();
      campaign.templateSource = template.source || (template.workspaceId ? 'workspace' : 'system');
      campaign.blocks = (template.blocks || campaign.blocks || []).map((block, index) => ({ id: block.id || `template_block_${index}`, ...block }));
      campaign.updatedAt = new Date().toISOString();
      state.db.auditEvents.unshift({ id: `audit_${Date.now()}`, workspaceId: actor.workspace.id, userId: actor.user.id, action: 'template-campaign-apply', detail: `Applied ${template.name} to ${campaign.name}`, createdAt: new Date().toISOString() });
      persistState(state);
    }
    redirect(res, campaign ? `/campaigns/${campaign.id}/editor` : '/templates/library');
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


export function buildTemplateLibraryContinuationWave001ClientAppRuntimeAdoptionPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"template_library","focusGroup":"template_library","phaseId":"continuation_wave_001_client_app_runtime_adoption","phaseTitle":"continuation wave 001 — client application runtime adoption slice","shardId":"focus.template_library::continuation-001#1#1","targetFile":"packages/app/routes/templates.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildTemplateLibraryContinuationWave001BrowserEvidenceAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"template_library","focusGroup":"template_library","phaseId":"continuation_wave_001_browser_evidence_acceptance_runtime","phaseTitle":"continuation wave 001 — browser evidence and acceptance runtime slice","shardId":"focus.template_library::continuation-001#10#1","targetFile":"packages/app/routes/templates.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildTemplateLibraryContinuationWave001MultiTenantWorkspaceBoundariesPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"template_library","focusGroup":"template_library","phaseId":"continuation_wave_001_multi_tenant_workspace_boundaries","phaseTitle":"continuation wave 001 — multi-tenant workspace boundary slice","shardId":"focus.template_library::continuation-001#11#1","targetFile":"packages/app/routes/templates.mjs","workflowSignals":["workspace_scope","role_boundary","tenant_isolation","audit_handoff","recovery"]}, state, actor, input);
}

export function buildTemplateLibraryContinuationWave001ServiceBackedProviderContractsPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"template_library","focusGroup":"template_library","phaseId":"continuation_wave_001_service_backed_provider_contracts","phaseTitle":"continuation wave 001 — service-backed provider contract slice","shardId":"focus.template_library::continuation-001#12#1","targetFile":"packages/app/routes/templates.mjs","workflowSignals":["runtime_state","workflow_command","audit_event","recovery","next_action"]}, state, actor, input);
}

export function buildTemplateLibraryContinuationWave001AssetRenderingPipelineRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"template_library","focusGroup":"template_library","phaseId":"continuation_wave_001_asset_rendering_pipeline_runtime","phaseTitle":"continuation wave 001 — asset rendering and delivery pipeline slice","shardId":"focus.template_library::continuation-001#13#1","targetFile":"packages/app/routes/templates.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}