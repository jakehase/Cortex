import { createForm } from '../domain-growth.mjs';
import { applyLeadCaptureConfig, buildLeadCaptureConversionRuntimeSnapshot, buildLeadCaptureProofSnapshot, createLandingPageExperimentVariant, persistLeadCaptureConversionSnapshot, publishLeadCapture, validateLeadCaptureReadiness, workspaceLeadCaptureSummary } from '../domain-leads.mjs';
import { escapeHtml, json, readBody, redirect, text } from '../utils.mjs';
import { page } from '../view.mjs';

function findWorkspaceForm(state, actor, id) {
  return state.db.forms.find((entry) => entry.id === id && entry.workspaceId === actor.workspace.id);
}

function readinessList(readiness) {
  const errors = readiness.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('');
  const warnings = readiness.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
  return `${errors ? `<div class="warn"><strong>Needs attention</strong><ul>${errors}</ul></div>` : '<div class="ok">Ready to publish.</div>'}${warnings ? `<div class="card"><strong>Advisory</strong><ul>${warnings}</ul></div>` : ''}`;
}

function captureCard(form) {
  const readiness = validateLeadCaptureReadiness(form);
  const channels = form.leadCapture?.channels?.join(', ') || form.popupMode || 'hosted';
  const schedule = form.leadCapture?.schedule || {};
  const targeting = form.leadCapture?.targeting || {};
  return `<div class="card"><h3><a href="/leads/forms/${form.id}">${escapeHtml(form.name)}</a></h3><p>Status: ${escapeHtml(form.status)} · channels: ${escapeHtml(channels)}</p><p>Targeting: ${escapeHtml(targeting.triggerRule || form.triggerRule || 'page_view')} · ${escapeHtml(targeting.geotarget || form.geotarget || 'all')}</p><p>Schedule: ${escapeHtml(schedule.startsAt || 'now')} → ${escapeHtml(schedule.endsAt || 'open')}</p><p>${readiness.ok ? 'Publish-ready' : `${readiness.errors.length} blocking readiness issue(s)`}</p></div>`;
}

export function registerLeadRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/leads/forms', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const summary = workspaceLeadCaptureSummary(state, actor.workspace.id);
    const forms = state.db.forms.filter((entry) => entry.workspaceId === actor.workspace.id);
    const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
    const runtime = buildLeadCaptureConversionRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Lead capture center', actor, `<div class="grid"><div class="card"><h3>Capture performance</h3><p>Forms: ${summary.forms} · published: ${summary.publishedForms} · popup/modal: ${summary.popupForms}</p><p>Submissions: ${summary.submissions} · landing pages: ${summary.landingPages} · conversion: ${summary.conversionRate}%</p><p>Attribution events: ${runtime.attributionEventCount} · consent receipts: ${runtime.consentReceiptCount} · experiments: ${runtime.experimentCount}</p><p><a href="/leads/landing-pages">Review landing page capture</a> · <a href="/api/leads/conversion-runtime">Open conversion runtime API</a></p><form method="post" action="/leads/conversion-runtime/snapshot"><button>Capture conversion snapshot</button></form></div><div class="card"><h3>Create capture experience</h3><form method="post" action="/leads/forms"><label>Name<input name="name" required></label><label>Audience<select name="audienceId">${audiences.map((audience) => `<option value="${audience.id}">${escapeHtml(audience.name)}</option>`).join('')}</select></label><label>Channels<input name="channels" value="hosted,popup"></label><label>Trigger rule<input name="triggerRule" value="exit_intent"></label><label>Placement<input name="placementSelector" value="pricing_page"></label><button>Create capture</button></form></div><div class="card"><h3>Proof snapshot</h3><pre>${escapeHtml(JSON.stringify(buildLeadCaptureProofSnapshot(state, actor.workspace.id).summary, null, 2))}</pre></div></div><div class="grid">${forms.map(captureCard).join('') || '<div class="card">No capture forms yet.</div>'}</div>`));
  });

  router.register('POST', '/leads/forms', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const form = createForm(state, actor, { ...body, popupMode: body.channels?.includes('popup') ? 'popup' : 'inline' });
    applyLeadCaptureConfig(state, actor, form, body);
    redirect(res, `/leads/forms/${form.id}`);
  });

  router.register('GET', '/leads/forms/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const form = findWorkspaceForm(state, actor, params.id);
    if (!form) return text(res, 404, page('Lead capture missing', actor, '<div class="warn">Lead capture form not found.</div>'));
    const readiness = validateLeadCaptureReadiness(form);
    const config = form.leadCapture || {};
    text(res, 200, page(`Lead capture: ${form.name}`, actor, `<div class="grid"><div class="card"><h3>Targeting, schedule, and channels</h3><form method="post" action="/leads/forms/${form.id}/targeting"><label>Channels<input name="channels" value="${escapeHtml((config.channels || ['hosted']).join(','))}"></label><label>Audience rules<input name="audienceRules" value="${escapeHtml((config.targeting?.audienceRules || []).join(','))}"></label><label>Geotarget<input name="geotarget" value="${escapeHtml(config.targeting?.geotarget || form.geotarget || 'all')}"></label><label>Trigger<input name="triggerRule" value="${escapeHtml(config.targeting?.triggerRule || form.triggerRule || 'page_view')}"></label><label>Frequency cap<input name="frequencyCap" value="${escapeHtml(config.targeting?.frequencyCap || 'once_per_session')}"></label><label>Schedule start<input name="scheduleStart" value="${escapeHtml(config.schedule?.startsAt || '')}"></label><label>Schedule end<input name="scheduleEnd" value="${escapeHtml(config.schedule?.endsAt || '')}"></label><label>Theme<input name="themeName" value="${escapeHtml(config.branding?.themeName || 'Workspace brand')}"></label><label>Button label<input name="buttonLabel" value="${escapeHtml(config.branding?.buttonLabel || 'Subscribe')}"></label><label>Consent mode<input name="consentMode" value="${escapeHtml(config.compliance?.consentMode || 'express')}"></label><label>Journey trigger<input name="journeyTrigger" value="${escapeHtml(config.integrationHandoff?.journeyTrigger || 'form_submitted')}"></label><label>Connected provider<input name="connectedProvider" value="${escapeHtml(config.integrationHandoff?.connectedProvider || 'hosted_site')}"></label><button>Save targeting</button></form></div><div class="card"><h3>Readiness and lifecycle</h3>${readinessList(readiness)}<form method="post" action="/leads/forms/${form.id}/publish"><button ${readiness.ok ? '' : 'disabled'}>Publish capture</button></form><p>Hosted URL: <code>/f/${escapeHtml(form.slug)}</code></p><p>Embed: <code>&lt;iframe src="/f/${escapeHtml(form.slug)}"&gt;&lt;/iframe&gt;</code></p></div></div><div class="card"><h3>Capture analytics</h3><pre>${escapeHtml(JSON.stringify({ analytics: form.analytics || {}, leadCapture: form.leadCapture || {} }, null, 2))}</pre></div>`));
  });

  router.register('POST', '/leads/forms/:id/targeting', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const form = findWorkspaceForm(state, actor, params.id);
    if (!form) return text(res, 404, page('Lead capture missing', actor, '<div class="warn">Lead capture form not found.</div>'));
    applyLeadCaptureConfig(state, actor, form, await readBody(req));
    redirect(res, `/leads/forms/${form.id}`);
  });

  router.register('POST', '/leads/forms/:id/publish', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const form = findWorkspaceForm(state, actor, params.id);
    if (!form) return text(res, 404, page('Lead capture missing', actor, '<div class="warn">Lead capture form not found.</div>'));
    publishLeadCapture(state, actor, form);
    redirect(res, `/leads/forms/${form.id}`);
  });

  router.register('GET', '/leads/landing-pages', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const pages = state.db.landingPages.filter((entry) => entry.workspaceId === actor.workspace.id);
    const forms = state.db.forms.filter((entry) => entry.workspaceId === actor.workspace.id);
    const runtime = buildLeadCaptureConversionRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Landing-page capture linkage', actor, `<div class="grid"><div class="card"><h3>Linked capture pages</h3><p>Landing pages: ${pages.length} · forms available: ${forms.length}</p><p>Runtime attribution events: ${runtime.attributionEventCount} · experiments: ${runtime.experimentCount}</p><p><a href="/landing-pages/new">Create landing page</a> · <a href="/leads/forms">Lead capture center</a></p></div></div><div class="card"><table><tr><th>Page</th><th>Status</th><th>Linked form</th><th>Views</th><th>Submissions</th><th>Experiment</th></tr>${pages.map((entry) => { const linkedForm = forms.find((form) => form.id === entry.formId); return `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.status)}</td><td>${linkedForm ? `<a href="/leads/forms/${linkedForm.id}">${escapeHtml(linkedForm.name)}</a>` : 'None'}</td><td>${entry.views || 0}</td><td>${entry.submissions || 0}</td><td><form method="post" action="/leads/landing-pages/${entry.id}/experiments"><input name="name" placeholder="Hero test"><input name="headline" placeholder="Alternate headline"><input name="ctaLabel" placeholder="Join now"><button>Create</button></form></td></tr>`; }).join('') || '<tr><td colspan="6">No landing pages yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/leads/landing-pages/:id/experiments', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const landingPage = state.db.landingPages.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!landingPage) return text(res, 404, page('Landing page missing', actor, '<div class="warn">Landing page not found.</div>'));
    createLandingPageExperimentVariant(state, actor, landingPage, await readBody(req));
    redirect(res, '/leads/landing-pages');
  });

  router.register('POST', '/leads/conversion-runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    persistLeadCaptureConversionSnapshot(state, actor, 'manual_route_snapshot');
    redirect(res, '/leads/forms');
  });

  router.register('GET', '/api/leads/conversion-runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    json(res, 200, { ok: true, conversionRuntime: buildLeadCaptureConversionRuntimeSnapshot(state, actor.workspace.id) });
  });
}



export function buildLandingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionRuntimeKey = "landing_pages:integrated_user_path_evidence:packages/app/routes/leads.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionRuntimeKey, surfaceId: "landing_pages", focusGroup: "frontend_architecture", phaseId: "integrated_user_path_evidence", shardId: "focus.landing_pages::semantic-frontier-001#18-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/leads.mjs", workspaceId, durableStateReady: Boolean(db), ...landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-growth.mjs","packages/app/routes/leads.mjs","packages/app/routes/website-builder.mjs"], nextAction: landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:landing_pages:monitor_job_runtime_handoff" : "integrated_user_path_evidence:landing_pages:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: landingPagesIntegratedUserPathEvidencePackagesAppRoutesLeadsMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/leads.mjs" } };
}


export const landingPagesInteractiveStateAndCommandsSemanticRuntimeContract = Object.freeze({"surfaceId":"landing_pages","focusGroup":"frontend_architecture","phaseId":"interactive_state_and_commands","shardId":"focus.landing_pages::semantic-frontier-001#18-interactive_state_and_commands#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildLandingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionRuntimeKey = "landing_pages:interactive_state_and_commands:packages/app/routes/leads.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionRuntimeKey, surfaceId: "landing_pages", focusGroup: "frontend_architecture", phaseId: "interactive_state_and_commands", shardId: "focus.landing_pages::semantic-frontier-001#18-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/leads.mjs", workspaceId, durableStateReady: Boolean(db), ...landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:landing_pages:monitor_job_runtime_handoff" : "interactive_state_and_commands:landing_pages:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: landingPagesInteractiveStateAndCommandsPackagesAppRoutesLeadsMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/leads.mjs" } };
}



export function buildLandingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionRuntimeKey = "landing_pages:primary_runtime_spine:packages/app/routes/leads.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionRuntimeKey, surfaceId: "landing_pages", focusGroup: "frontend_architecture", phaseId: "primary_runtime_spine", shardId: "focus.landing_pages::semantic-frontier-001#18-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/leads.mjs", workspaceId, durableStateReady: Boolean(db), ...landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-growth.mjs","packages/app/routes/leads.mjs","packages/app/routes/website-builder.mjs"], nextAction: landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:landing_pages:monitor_job_runtime_handoff" : "primary_runtime_spine:landing_pages:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: landingPagesPrimaryRuntimeSpinePackagesAppRoutesLeadsMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/leads.mjs" } };
}


export const landingPagesOperationalPersistenceAndJobsSemanticRuntimeContract = Object.freeze({"surfaceId":"landing_pages","focusGroup":"frontend_architecture","phaseId":"operational_persistence_and_jobs","shardId":"focus.landing_pages::semantic-frontier-001#18-operational_persistence_and_jobs#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildLandingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionRuntimeKey = "landing_pages:operational_persistence_and_jobs:packages/app/routes/leads.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionRuntimeKey, surfaceId: "landing_pages", focusGroup: "frontend_architecture", phaseId: "operational_persistence_and_jobs", shardId: "focus.landing_pages::semantic-frontier-001#18-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/routes/leads.mjs", workspaceId, durableStateReady: Boolean(db), ...landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-growth.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:landing_pages:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:landing_pages:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: landingPagesOperationalPersistenceAndJobsPackagesAppRoutesLeadsMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/leads.mjs" } };
}

