import { saveDb } from '../storage.mjs';
import { page } from '../view.mjs';
import { recordAudit } from '../domain-core.mjs';
import { campaignAutomationRuntimeSummary } from '../domain-campaigns.mjs';
import { AUTOMATION_TRIGGERS, automationRunSummary, createAutomation, updateAutomationLifecycle, validateAutomation } from '../domain-growth.mjs';
import { createId, readBody, redirect, text } from '../utils.mjs';

function automationOrchestrationSummary(state, automation) {
  const sourceCampaign = automation.sourceCampaignId
    ? state.db.campaigns.find((entry) => entry.id === automation.sourceCampaignId && entry.workspaceId === automation.workspaceId) || null
    : null;
  const campaignRuntime = sourceCampaign ? campaignAutomationRuntimeSummary(state, sourceCampaign) : null;
  const recentCampaignRuns = state.db.automationRuns
    .filter((run) => run.automationId === automation.id && run.campaignId)
    .slice(0, 3);
  return { sourceCampaign, campaignRuntime, recentCampaignRuns };
}

export function registerAutomationRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/automations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const automations = state.db.automations.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Automations overview', actor, `<div class="grid"><div class="card"><p><a href="/automations/new">Create automation</a></p><p>Templates: ${state.db.journeyTemplates.map((entry) => entry.name).join(', ')}</p></div>${automations.map((automation) => `<div class="card"><h3><a href="/automations/${automation.id}/builder">${automation.name}</a></h3><p>Status: ${automation.status}</p><p>Trigger: ${automation.trigger || 'missing'}</p><p>Nodes: ${automation.nodes.length}</p><p>Runs: ${state.db.automationRuns.filter((run) => run.automationId === automation.id).length}</p></div>`).join('')}</div>`));
  });

  router.register('GET', '/automations/new', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Create automation', actor, `<div class="card"><form method="post" action="/automations"><input name="name" placeholder="Welcome flow" required><select name="audienceId">${audiences.map((entry) => `<option value="${entry.id}">${entry.name}</option>`).join('')}</select><input name="trigger" placeholder="contact_subscribed"><button>Create automation</button></form></div>`));
  });

  router.register('POST', '/automations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const automation = createAutomation(state, actor, await readBody(req));
    redirect(res, `/automations/${automation.id}/builder`);
  });

  router.register('GET', '/automations/:id/builder', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const automation = state.db.automations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    validateAutomation(state, automation);
    const runSummary = automationRunSummary(state, automation);
    const forms = state.db.forms.filter((entry) => entry.workspaceId === actor.workspace.id);
    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);
    const orchestration = automationOrchestrationSummary(state, automation);
    text(res, 200, page(`Journey builder: ${automation.name}`, actor, `<div class="grid"><div class="card"><h3>Journey config</h3><form method="post" action="/automations/${automation.id}/builder/config"><input name="name" value="${automation.name}"><input name="trigger" value="${automation.trigger || ''}" placeholder="contact_subscribed"><select name="audienceId">${state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id).map((audience) => `<option value="${audience.id}" ${audience.id === automation.audienceId ? 'selected' : ''}>${audience.name}</option>`).join('')}</select><select name="sourceFormId"><option value="">Any form</option>${forms.map((form) => `<option value="${form.id}" ${form.id === automation.sourceFormId ? 'selected' : ''}>${form.name}</option>`).join('')}</select><select name="sourceCampaignId"><option value="">Any campaign</option>${campaigns.map((campaign) => `<option value="${campaign.id}" ${campaign.id === automation.sourceCampaignId ? 'selected' : ''}>${campaign.name}</option>`).join('')}</select><select name="reentryPolicy"><option value="once_per_contact" ${automation.reentryPolicy === 'once_per_contact' ? 'selected' : ''}>once_per_contact</option><option value="always" ${automation.reentryPolicy === 'always' ? 'selected' : ''}>always</option></select><input name="goal" value="${automation.goal || ''}" placeholder="Recover abandoned lead"><button>Save config</button></form><p class="muted">Supported triggers: ${AUTOMATION_TRIGGERS.map((entry) => `${entry.id} (${entry.label})`).join(', ')}</p>${automation.validationErrors.length ? `<div class="warn"><ul>${automation.validationErrors.map((error) => `<li>${error}</li>`).join('')}</ul></div>` : '<div class="ok">Journey validates cleanly.</div>'}</div><div class="card"><h3>Add node</h3><form method="post" action="/automations/${automation.id}/builder/nodes"><select name="type"><option value="email">email</option><option value="delay">delay</option><option value="branch">branch</option><option value="tag">tag</option><option value="sms">sms</option><option value="social">social</option><option value="ads">ads</option></select><input name="title" placeholder="Node title"><input name="delayHours" placeholder="24"><input name="conditions" placeholder="opened,clicked"><button>Add node</button></form></div><div class="card"><h3>AI + omnichannel</h3><p><a href="/automations/${automation.id}/ai">Generate an AI journey recommendation</a></p><p><a href="/omnichannel">Create SMS/social/ad programs</a></p></div><div class="card"><h3>Journey orchestration</h3><p>Source campaign: ${orchestration.sourceCampaign ? orchestration.sourceCampaign.name : 'None selected'}</p><p>Linked campaign journeys: ${orchestration.campaignRuntime?.linkedAutomations || 0}</p><p>Live campaign journeys: ${orchestration.campaignRuntime?.liveAutomations || 0}</p><p>Campaign-triggered runs: ${orchestration.campaignRuntime?.relatedRuns || runSummary.campaignTriggeredRuns}</p>${orchestration.recentCampaignRuns.length ? `<ul>${orchestration.recentCampaignRuns.map((run) => `<li>${run.trigger} · ${run.campaignId} · ${run.completedAt || 'in flight'}</li>`).join('')}</ul>` : '<p class="muted">No campaign-triggered runtime yet.</p>'}</div><div class="card"><h3>Enrollment summary</h3><p>Total runs: ${runSummary.totalRuns}</p><p>Completed: ${runSummary.completedRuns}</p><p>Form-triggered: ${runSummary.formTriggeredRuns}</p><p>Campaign-triggered: ${runSummary.campaignTriggeredRuns}</p></div></div><div class="card"><h3>Journey nodes</h3><table><tr><th>Type</th><th>Title</th><th>Config</th></tr>${automation.nodes.map((node, index) => `<tr><td>${index + 1}. ${node.type}</td><td>${node.title}</td><td>${node.delayHours || ''} ${node.conditions?.join('/') || ''}</td></tr>`).join('')}</table></div><div class="card"><h3>Recent runs</h3><table><tr><th>Trigger</th><th>Contact</th><th>Form</th><th>Campaign</th><th>Completed</th></tr>${runSummary.latestRuns.map((run) => `<tr><td>${run.trigger}</td><td>${run.contactId}</td><td>${run.formId || '—'}</td><td>${run.campaignId || '—'}</td><td>${run.completedAt}</td></tr>`).join('') || '<tr><td colspan="5">No runs yet.</td></tr>'}</table></div><div class="grid"><div class="card"><form method="post" action="/automations/${automation.id}/publish"><button ${automation.validationErrors.length ? 'disabled' : ''}>Publish</button></form></div><div class="card"><form method="post" action="/automations/${automation.id}/pause"><button ${automation.status !== 'live' ? 'disabled' : ''}>Pause</button></form></div><div class="card"><form method="post" action="/automations/${automation.id}/resume"><button ${automation.status !== 'paused' ? 'disabled' : ''}>Resume</button></form></div></div>`));
  });

  router.register('POST', '/automations/:id/builder/config', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const automation = state.db.automations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const body = await readBody(req);
    Object.assign(automation, body, { updatedAt: new Date().toISOString() });
    saveDb(state.db);
    redirect(res, `/automations/${automation.id}/builder`);
  });

  router.register('POST', '/automations/:id/builder/nodes', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const automation = state.db.automations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const body = await readBody(req); automation.nodes.push({ id: createId('node'), type: body.type, title: body.title || body.type, delayHours: body.delayHours ? Number(body.delayHours) : 0, conditions: String(body.conditions || '').split(',').map((entry) => entry.trim()).filter(Boolean) }); saveDb(state.db); redirect(res, `/automations/${automation.id}/builder`);
  });

  for (const [routeName, status] of [['publish', 'live'], ['pause', 'paused'], ['resume', 'live']]) {
    router.register('POST', `/automations/:id/${routeName}`, async ({ state, req, params, res }) => {
      const actor = requireAuth(state, req, res); if (!actor) return;
      const automation = state.db.automations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
      if (routeName === 'publish' && validateAutomation(state, automation).length) return redirect(res, `/automations/${automation.id}/builder`);
      updateAutomationLifecycle(state, actor, automation, status);
      redirect(res, `/automations/${automation.id}/builder`);
    });
  }
}
