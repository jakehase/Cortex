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
