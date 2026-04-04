import { saveDb } from '../storage.mjs';
import { createExport, apiActor, recordAudit } from '../domain-core.mjs';
import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';
import { createContact, updateContact } from '../domain-audience.mjs';
import { revenueSummary } from '../domain-commerce-revenue.mjs';
import { workspaceIntegrationInstallations, syncMarketplaceInstallation } from '../domain-integration-marketplace.mjs';
import { approvalSummary } from '../domain-collaboration-approval.mjs';
import { contentStudioSummary, workspaceContentTemplates } from '../domain-template-assets.mjs';
import { deliverabilityHealth } from '../domain-deliverability-compliance.mjs';
import { page } from '../view.mjs';
import { createId, csv, json, readBody, redirect, text } from '../utils.mjs';

export function registerApiAdminRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/api/me', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, user: { id: actor.user.id, name: actor.user.name, email: actor.user.email, role: actor.membership.role }, workspace: { id: actor.workspace.id, name: actor.workspace.name, planId: actor.workspace.planId, apiKeyPreview: actor.workspace.apiKey.slice(0, 10) } });
  });

  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    let contacts = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id);
    if (url.searchParams.get('audienceId')) contacts = contacts.filter((entry) => entry.audienceId === url.searchParams.get('audienceId'));
    json(res, 200, { ok: true, contacts });
  });

  router.register('POST', '/api/contacts', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.email) return json(res, 422, { ok: false, error: 'Email required' });
    const contact = createContact(state, actor, { ...body, audienceId: body.audienceId || state.db.audiences.find((entry) => entry.workspaceId === actor.workspace.id)?.id, source: 'api', activity: 'Created via API' });
    json(res, 201, { ok: true, contact });
  });

  router.register('PATCH', '/api/contacts/:id', async ({ state, req, params, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const contact = state.db.contacts.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!contact) return json(res, 404, { ok: false, error: 'Contact not found' });
    updateContact(state, actor, contact, { ...contact, ...(await readBody(req)) }, true);
    json(res, 200, { ok: true, contact });
  });

  router.register('GET', '/api/integrations', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, integrations: workspaceIntegrationInstallations(state, actor.workspace.id) });
  });

  router.register('POST', '/api/integrations/:id/sync', async ({ state, req, params, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const installation = state.db.integrationInstallations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!installation) return json(res, 404, { ok: false, error: 'Integration not found' });
    json(res, 200, { ok: true, result: syncMarketplaceInstallation(state, actor, installation) });
  });

  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, revenue: revenueSummary(state, actor.workspace.id) });
  });

  router.register('GET', '/api/deliverability/health', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, deliverability: deliverabilityHealth(state, actor.workspace.id) });
  });

  router.register('GET', '/api/approvals', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, {
      ok: true,
      approvals: approvalSummary(state, actor.workspace.id),
      requests: state.db.approvalRequests.filter((entry) => entry.workspaceId === actor.workspace.id)
    });
  });

  router.register('GET', '/api/content/templates', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, {
      ok: true,
      content: contentStudioSummary(state, actor.workspace.id),
      templates: workspaceContentTemplates(state, actor.workspace.id)
    });
  });

  for (const [title, pathName, source] of [['Background jobs', '/jobs', 'jobs'], ['Event stream', '/events', 'events'], ['Notification outbox', '/notifications', 'notifications']]) {
    router.register('GET', pathName, async ({ state, req, res }) => {
      const actor = requireAuth(state, req, res);
      if (!actor) return;
      const rows = state.db[source].filter((entry) => entry.workspaceId === actor.workspace.id || source === 'events' && entry.workspaceId === actor.workspace.id);
      text(res, 200, page(title, actor, `<div class="card"><table><tr><th>ID/When</th><th>Type</th><th>Status/Message</th><th>Payload</th></tr>${rows.map((row) => `<tr><td>${row.id || row.createdAt}</td><td>${row.type || row.action}</td><td>${row.status || row.message || row.level}</td><td><code>${JSON.stringify(row.payload || row.result || row.meta || '')}</code></td></tr>`).join('')}</table></div>`));
    });
  }

  router.register('GET', '/audit', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const rows = state.db.auditEvents.filter((entry) => entry.workspaceId === actor.workspace.id);
    const gate = actor.workspace.planId !== 'starter' && actor.workspace.featureFlags.auditExport ? '<p><a href="/audit/export.csv">Export CSV</a></p>' : '<div class="warn">Audit export is visible but upgrade-gated until Growth plan plus audit export flag are enabled.</div>';
    text(res, 200, page('Audit events', actor, `<div class="card">${gate}<table><tr><th>When</th><th>Action</th><th>Detail</th></tr>${rows.map((row) => `<tr><td>${row.createdAt}</td><td>${row.action}</td><td>${row.detail}</td></tr>`).join('')}</table></div>`));
  });

  router.register('GET', '/audit/export.csv', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const rows = state.db.auditEvents.filter((entry) => entry.workspaceId === actor.workspace.id);
    csv(res, 'audit-events.csv', ['createdAt,action,detail', ...rows.map((row) => `${row.createdAt},${row.action},${JSON.stringify(row.detail)}`)].join('\n'));
  });

  router.register('GET', '/admin', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Admin shell', actor, '<div class="grid"><div class="card"><h3>Protected surfaces</h3><p>API auth, jobs, notifications, events, audit log, feature flags, billing gates, approvals, deliverability, and integration controls live under authenticated routes.</p></div><div class="card"><h3>Observability</h3><p><a href="/status">Public status JSON</a></p><p><a href="/jobs">Jobs</a> · <a href="/events">Events</a> · <a href="/notifications">Notifications</a></p></div><div class="card"><h3>Workspace config</h3><p><a href="/settings">Settings</a> · <a href="/developer/api-keys">API keys</a> · <a href="/developer/webhooks">Webhooks</a> · <a href="/admin/system">System state</a></p><p><a href="/integrations">Integrations</a> · <a href="/commerce">Commerce</a> · <a href="/approvals">Approvals</a> · <a href="/deliverability">Deliverability</a> · <a href="/content">Content studio</a></p></div></div>'));
  });

  router.register('GET', '/admin/system', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const summary = workspaceSummary(state, actor.workspace.id);
    const trends = analyticsSeries(state, actor.workspace.id);
    text(res, 200, page('Admin system state', actor, `<div class="grid"><div class="card"><h3>Workspace summary</h3><pre>${JSON.stringify(summary, null, 2)}</pre></div><div class="card"><h3>Trend state</h3><pre>${JSON.stringify(trends, null, 2)}</pre></div><div class="card"><h3>Wave 2 governance state</h3><pre>${JSON.stringify({ revenue: revenueSummary(state, actor.workspace.id), approvals: approvalSummary(state, actor.workspace.id), deliverability: deliverabilityHealth(state, actor.workspace.id), content: contentStudioSummary(state, actor.workspace.id) }, null, 2)}</pre></div><div class="card"><h3>Export state</h3><p><a href="/admin/exports">Export history</a></p></div></div>`));
  });

  router.register('GET', '/admin/exports', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const exports = state.db.exports.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Export history', actor, `<div class="grid"><div class="card"><form method="post" action="/admin/exports"><input name="label" value="workspace-state"><button>Create export</button></form></div><div class="card"><table><tr><th>Label</th><th>Path</th><th>When</th></tr>${exports.map((entry) => `<tr><td>${entry.label}</td><td><code>${entry.storagePath}</code></td><td>${entry.createdAt}</td></tr>`).join('')}</table></div></div>`));
  });

  router.register('POST', '/admin/exports', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    createExport(state, actor, body.label || 'workspace-state', { workspace: actor.workspace, contacts: state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id), campaigns: state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id), automations: state.db.automations.filter((entry) => entry.workspaceId === actor.workspace.id), forms: state.db.forms.filter((entry) => entry.workspaceId === actor.workspace.id), landingPages: state.db.landingPages.filter((entry) => entry.workspaceId === actor.workspace.id) });
    redirect(res, '/admin/exports');
  });

  router.register('GET', '/developer/api-keys', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const keys = state.db.apiKeys.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Developer API keys', actor, `<div class="grid"><div class="card"><form method="post" action="/developer/api-keys"><input name="label" placeholder="Build integration"><button>Create key</button></form></div><div class="card"><table><tr><th>Label</th><th>Token</th><th>Status</th><th>Actions</th></tr>${keys.map((entry) => `<tr><td>${entry.label}</td><td><code>${entry.token}</code></td><td>${entry.revokedAt ? 'revoked' : 'active'}</td><td>${entry.revokedAt ? '—' : `<form method="post" action="/developer/api-keys/${entry.id}/revoke"><button>Revoke</button></form>`}</td></tr>`).join('')}</table></div></div>`));
  });

  router.register('POST', '/developer/api-keys', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    state.db.apiKeys.unshift({ id: createId('apikey'), workspaceId: actor.workspace.id, label: body.label || 'Generated key', token: createId('key'), createdBy: actor.user.id, createdAt: new Date().toISOString(), revokedAt: null });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'api-key-create', detail: 'Created API key' });
    redirect(res, '/developer/api-keys');
  });

  router.register('POST', '/developer/api-keys/:id/revoke', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const key = state.db.apiKeys.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (key) key.revokedAt = new Date().toISOString();
    saveDb(state.db);
    redirect(res, '/developer/api-keys');
  });

  router.register('GET', '/developer/webhooks', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const hooks = state.db.webhooks.filter((entry) => entry.workspaceId === actor.workspace.id);
    const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 20);
    text(res, 200, page('Developer webhooks', actor, `<div class="grid"><div class="card"><form method="post" action="/developer/webhooks"><input name="targetUrl" placeholder="https://example.test/webhook" required><input name="events" value="audit,notification:campaign-send"><button>Create webhook</button></form></div><div class="card"><table><tr><th>Target</th><th>Status</th></tr>${hooks.map((entry) => `<tr><td>${entry.targetUrl}</td><td>${entry.status}</td></tr>`).join('')}</table></div></div><div class="card"><h3>Delivery history</h3><table><tr><th>Event</th><th>Target</th><th>Status</th></tr>${deliveries.map((entry) => `<tr><td>${entry.eventType}</td><td>${entry.targetUrl}</td><td>${entry.status}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/developer/webhooks', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    state.db.webhooks.unshift({ id: createId('hook'), workspaceId: actor.workspace.id, targetUrl: body.targetUrl, events: String(body.events || '').split(',').map((entry) => entry.trim()).filter(Boolean), status: 'active', createdAt: new Date().toISOString() });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'webhook-create', detail: `Created webhook ${body.targetUrl}` });
    redirect(res, '/developer/webhooks');
  });
}
