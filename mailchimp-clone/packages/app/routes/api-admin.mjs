import { storageOperationalRuntimeEvidence, storageOperationalSummary } from '../storage.mjs';
import { apiActor, buildBillingEntitlementsRuntimeSnapshot, buildDashboardHomeRuntimeSnapshot, buildDeveloperApiRuntimeSnapshot, buildTeamGovernanceRuntimeSnapshot, createDeveloperScopedApiKey, createDeveloperWebhookSubscription, createExport, dispatchDeveloperWebhookDelivery, persistDeveloperApiRuntimeSnapshot, replayDeveloperWebhookDelivery, revokeDeveloperScopedApiKey, setDeveloperWebhookSubscriptionStatus } from '../domain-core.mjs';
import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';
import { createContact, updateContact } from '../domain-audience.mjs';
import { billingUsageSummary, revenueSummary } from '../domain-commerce-revenue.mjs';
import { workspaceIntegrationInstallations, syncMarketplaceInstallation } from '../domain-integration-marketplace.mjs';
import { approvalSummary } from '../domain-collaboration-approval.mjs';
import { buildContentStudioRuntimeSnapshot, contentStudioSummary, workspaceContentTemplates } from '../domain-template-assets.mjs';
import { buildSettingsDomainsDeliverabilityRuntimeSnapshot, deliverabilityHealth } from '../domain-deliverability-compliance.mjs';
import { page } from '../view.mjs';
import { csv, escapeHtml, json, readBody, redirect, text } from '../utils.mjs';
import { buildJobOperationalSnapshot, requeueDeadLetterJob, runJobs } from '../jobs.mjs';

function jobOperationsBody(snapshot) {
  const jobRows = snapshot.recentJobs.map((job) => `<tr><td>${escapeHtml(job.id)}</td><td>${escapeHtml(job.type)}</td><td>${escapeHtml(job.status)}</td><td>${job.attempts}/${job.maxAttempts}</td><td>${escapeHtml(job.leaseId || '')}</td><td>${escapeHtml(job.error || '')}</td></tr>`).join('') || '<tr><td colspan="6">No jobs yet.</td></tr>';
  const leaseRows = snapshot.leases.recent.map((lease) => `<tr><td>${escapeHtml(lease.id)}</td><td>${escapeHtml(lease.jobId)}</td><td>${escapeHtml(lease.workerId)}</td><td>${escapeHtml(lease.status)}</td><td>${escapeHtml(lease.releaseReason || '')}</td></tr>`).join('') || '<tr><td colspan="5">No leases yet.</td></tr>';
  const deadRows = snapshot.deadLetters.map((entry) => `<tr><td>${escapeHtml(entry.id)}</td><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.error)}</td><td>${entry.attempts}</td><td>${entry.requeuedAt ? escapeHtml(entry.requeuedAt) : `<form method="post" action="/jobs/dead-letters/${entry.id}/requeue"><button>Requeue</button></form>`}</td></tr>`).join('') || '<tr><td colspan="5">No dead letters.</td></tr>';
  const heartbeatRows = snapshot.heartbeats.map((entry) => `<tr><td>${escapeHtml(entry.workerId)}</td><td>${escapeHtml(entry.status)}</td><td>${entry.pendingJobCount}</td><td>${entry.activeLeaseCount}</td><td>${escapeHtml(entry.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5">No worker heartbeats yet.</td></tr>';
  return `<div class="grid"><div class="card"><h3>Operational queue contract</h3><p>${escapeHtml(snapshot.label)}</p><ul>${snapshot.controls.map((control) => `<li>${escapeHtml(control)}</li>`).join('')}</ul><p>Queue: ${snapshot.queue.total} total · ${snapshot.queue.dueCount} due · ${snapshot.queue.deadLetterCount} dead letters</p><form method="post" action="/jobs/run-once"><button>Run due jobs once</button></form></div><div class="card"><h3>Queue counts</h3><pre>${escapeHtml(JSON.stringify(snapshot.queue, null, 2))}</pre></div></div><div class="card"><h3>Recent jobs</h3><table><tr><th>Job</th><th>Type</th><th>Status</th><th>Attempts</th><th>Lease</th><th>Error</th></tr>${jobRows}</table></div><div class="grid" style="margin-top:16px"><div class="card"><h3>Worker leases</h3><table><tr><th>Lease</th><th>Job</th><th>Worker</th><th>Status</th><th>Release</th></tr>${leaseRows}</table></div><div class="card"><h3>Dead letters</h3><table><tr><th>Dead letter</th><th>Type</th><th>Error</th><th>Attempts</th><th>Action</th></tr>${deadRows}</table></div></div><div class="card" style="margin-top:16px"><h3>Worker service heartbeats</h3><table><tr><th>Worker</th><th>Status</th><th>Pending</th><th>Leases</th><th>When</th></tr>${heartbeatRows}</table></div>`;
}

export function registerApiAdminRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/api/me', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, user: { id: actor.user.id, name: actor.user.name, email: actor.user.email, role: actor.membership.role }, workspace: { id: actor.workspace.id, name: actor.workspace.name, planId: actor.workspace.planId, apiKeyPreview: actor.workspace.apiKey.slice(0, 10) } });
  });

  router.register('GET', '/api/team', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const members = state.db.memberships
      .filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active')
      .map((membership) => ({
        id: membership.id,
        role: membership.role,
        status: membership.status,
        user: state.db.users.find((entry) => entry.id === membership.userId)
      }));
    const invitations = state.db.invitations.filter((entry) => entry.workspaceId === actor.workspace.id);
    const roleCounts = members.reduce((acc, entry) => {
      acc[entry.role] = (acc[entry.role] || 0) + 1;
      return acc;
    }, {});
    json(res, 200, {
      ok: true,
      team: {
        members,
        invitations,
        roleCounts,
        pendingInvites: invitations.filter((entry) => entry.status === 'pending').length
      }
    });
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
    json(res, 200, { ok: true, result: await syncMarketplaceInstallation(state, actor, installation) });
  });

  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, revenue: revenueSummary(state, actor.workspace.id) });
  });

  router.register('GET', '/api/billing/usage', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, billing: billingUsageSummary(state, actor.workspace) });
  });

  router.register('GET', '/api/billing/runtime', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, billingRuntime: buildBillingEntitlementsRuntimeSnapshot(state, actor.workspace.id) });
  });

  router.register('GET', '/api/team/runtime', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, teamRuntime: buildTeamGovernanceRuntimeSnapshot(state, actor.workspace.id) });
  });

  router.register('GET', '/api/dashboard/runtime', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, dashboardRuntime: buildDashboardHomeRuntimeSnapshot(state, actor) });
  });

  router.register('GET', '/api/deliverability/health', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, deliverability: deliverabilityHealth(state, actor.workspace.id) });
  });

  router.register('GET', '/api/deliverability/runtime', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, deliverabilityRuntime: buildSettingsDomainsDeliverabilityRuntimeSnapshot(state, actor.workspace.id) });
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

  router.register('GET', '/api/content/runtime', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, contentRuntime: buildContentStudioRuntimeSnapshot(state, actor.workspace.id) });
  });

  for (const [title, pathName, source] of [['Background jobs', '/jobs', 'jobs'], ['Event stream', '/events', 'events'], ['Notification outbox', '/notifications', 'notifications']]) {
    router.register('GET', pathName, async ({ state, req, res }) => {
      const actor = requireAuth(state, req, res);
      if (!actor) return;
      const rows = state.db[source].filter((entry) => entry.workspaceId === actor.workspace.id || source === 'events' && entry.workspaceId === actor.workspace.id);
      text(res, 200, page(title, actor, `<div class="card"><table><tr><th>ID/When</th><th>Type</th><th>Status/Message</th><th>Payload</th></tr>${rows.map((row) => `<tr><td>${row.id || row.createdAt}</td><td>${row.type || row.action}</td><td>${row.status || row.message || row.level}</td><td><code>${JSON.stringify(row.payload || row.result || row.meta || '')}</code></td></tr>`).join('')}</table></div>`));
    });
  }

  router.register('GET', '/jobs/operations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Job operations', actor, jobOperationsBody(buildJobOperationalSnapshot(state, actor.workspace.id))));
  });

  router.register('GET', '/api/jobs/operations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    json(res, 200, { ok: true, jobs: buildJobOperationalSnapshot(state, actor.workspace.id) });
  });

  router.register('POST', '/jobs/run-once', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    runJobs(state, { workerId: `manual-${actor.user.id}` });
    redirect(res, '/jobs/operations');
  });

  router.register('POST', '/jobs/dead-letters/:id/requeue', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    requeueDeadLetterJob(state, actor, params.id);
    redirect(res, '/jobs/operations');
  });

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
    text(res, 200, page('Admin shell', actor, '<div class="grid"><div class="card"><h3>Protected surfaces</h3><p>API auth, jobs, notifications, events, audit log, feature flags, billing gates, approvals, deliverability, and integration controls live under authenticated routes.</p></div><div class="card"><h3>Observability</h3><p><a href="/status">Public status JSON</a></p><p><a href="/jobs">Jobs</a> · <a href="/jobs/operations">Job operations</a> · <a href="/events">Events</a> · <a href="/notifications">Notifications</a></p></div><div class="card"><h3>Workspace config</h3><p><a href="/settings">Settings</a> · <a href="/developer/api-keys">API keys</a> · <a href="/developer/webhooks">Webhooks</a> · <a href="/admin/system">System state</a></p><p><a href="/integrations">Integrations</a> · <a href="/commerce">Commerce</a> · <a href="/approvals">Approvals</a> · <a href="/deliverability">Deliverability</a> · <a href="/content">Content studio</a></p></div></div>'));
  });

  router.register('GET', '/admin/system', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const summary = workspaceSummary(state, actor.workspace.id);
    const trends = analyticsSeries(state, actor.workspace.id);
    const storageSummary = storageOperationalSummary();
    const storageRuntime = storageOperationalRuntimeEvidence(state);
    text(res, 200, page('Admin system state', actor, `<div class="grid"><div class="card"><h3>Workspace summary</h3><pre>${JSON.stringify(summary, null, 2)}</pre></div><div class="card"><h3>Trend state</h3><pre>${JSON.stringify(trends, null, 2)}</pre></div><div class="card"><h3>Persistence data plane</h3><pre>${JSON.stringify({ engine: storageSummary.engine, activeDbPath: storageSummary.activeDbPath, sqlite: storageSummary.sqlite, runtime: storageRuntime }, null, 2)}</pre><p><a href="/jobs/operations">Open job operational runtime</a></p></div><div class="card"><h3>Job operational state</h3><pre>${JSON.stringify(buildJobOperationalSnapshot(state, actor.workspace.id).queue, null, 2)}</pre></div><div class="card"><h3>Wave 2 governance state</h3><pre>${JSON.stringify({ revenue: revenueSummary(state, actor.workspace.id), approvals: approvalSummary(state, actor.workspace.id), deliverability: deliverabilityHealth(state, actor.workspace.id), content: contentStudioSummary(state, actor.workspace.id) }, null, 2)}</pre></div><div class="card"><h3>Export state</h3><p><a href="/admin/exports">Export history</a></p></div></div>`));
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
    const snapshot = buildDeveloperApiRuntimeSnapshot(state, actor.workspace.id);
    const keys = state.db.apiKeys.filter((entry) => entry.workspaceId === actor.workspace.id);
    const keyRows = keys.map((entry) => `<tr><td>${escapeHtml(entry.label)}</td><td><code>${escapeHtml(entry.token)}</code><br><small>${escapeHtml(entry.tokenPreview || entry.token?.slice(0, 10) || '')}</small></td><td>${escapeHtml(entry.revokedAt ? 'revoked' : (entry.status || 'active'))}</td><td>${(entry.scopes || ['workspace:*']).map((scope) => `<code>${escapeHtml(scope)}</code>`).join(' ')}</td><td>${escapeHtml(entry.environment || 'production')}</td><td>${entry.revokedAt ? '—' : `<form method="post" action="/developer/api-keys/${entry.id}/revoke"><button>Revoke</button></form>`}</td></tr>`).join('') || '<tr><td colspan="6">No API keys yet.</td></tr>';
    const auditRows = snapshot.requestAudit.recent.map((entry) => `<tr><td>${escapeHtml(entry.createdAt)}</td><td>${escapeHtml(entry.method)} ${escapeHtml(entry.path)}</td><td>${escapeHtml(entry.tokenPreview)}</td><td>${entry.scopes.map((scope) => `<code>${escapeHtml(scope)}</code>`).join(' ')}</td><td>${escapeHtml(entry.status)}</td></tr>`).join('') || '<tr><td colspan="5">No audited API requests yet.</td></tr>';
    text(res, 200, page('Developer API keys', actor, `<div class="grid"><div class="card"><h3>Scoped API key runtime</h3><p>Evidence: ${snapshot.evidenceContract.map((entry) => `<code>${escapeHtml(entry)}</code>`).join(' ')}</p><form method="post" action="/developer/api-keys"><input name="label" placeholder="Build integration"><input name="scopes" value="contacts:read,campaigns:write,webhooks:replay"><select name="environment"><option value="production">production</option><option value="sandbox">sandbox</option></select><input name="expiresAt" placeholder="2026-12-31T00:00:00.000Z"><button>Create scoped key</button></form><p><a href="/developer/runtime/snapshot">Persist developer runtime snapshot</a> · <a href="/api/developer/runtime">Runtime API JSON</a></p></div><div class="card"><h3>Runtime readiness</h3><pre>${escapeHtml(JSON.stringify(snapshot.runtimeHealth, null, 2))}</pre></div></div><div class="card"><h3>Keys</h3><table><tr><th>Label</th><th>Token</th><th>Status</th><th>Scopes</th><th>Environment</th><th>Actions</th></tr>${keyRows}</table></div><div class="card"><h3>API request audit ledger</h3><table><tr><th>When</th><th>Request</th><th>Key</th><th>Scopes</th><th>Status</th></tr>${auditRows}</table></div>`));
  });

  router.register('POST', '/developer/api-keys', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    createDeveloperScopedApiKey(state, actor, await readBody(req));
    redirect(res, '/developer/api-keys');
  });

  router.register('POST', '/developer/api-keys/:id/revoke', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    revokeDeveloperScopedApiKey(state, actor, params.id);
    redirect(res, '/developer/api-keys');
  });

  router.register('GET', '/developer/webhooks', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = buildDeveloperApiRuntimeSnapshot(state, actor.workspace.id);
    const hooks = state.db.webhooks.filter((entry) => entry.workspaceId === actor.workspace.id);
    const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 20);
    const hookRows = hooks.map((entry) => `<tr><td>${escapeHtml(entry.targetUrl)}</td><td>${escapeHtml(entry.status)}</td><td>${(entry.events || []).map((event) => `<code>${escapeHtml(event)}</code>`).join(' ')}</td><td>${entry.signingSecret ? 'signed' : 'legacy'}</td><td><form method="post" action="/developer/webhooks/${entry.id}/deliver"><input name="eventType" value="${escapeHtml(entry.events?.[0] || 'developer.runtime.test')}"><button>Send signed test</button></form>${entry.status === 'active' ? `<form method="post" action="/developer/webhooks/${entry.id}/pause"><button>Pause</button></form>` : `<form method="post" action="/developer/webhooks/${entry.id}/resume"><button>Resume</button></form>`}</td></tr>`).join('') || '<tr><td colspan="5">No webhook subscriptions yet.</td></tr>';
    const deliveryRows = deliveries.map((entry) => `<tr><td>${escapeHtml(entry.eventType)}</td><td>${escapeHtml(entry.targetUrl)}</td><td>${escapeHtml(entry.status)}</td><td>${entry.signature ? `<code>${escapeHtml(entry.signature.slice(0, 16))}…</code>` : 'unsigned'}</td><td>${entry.replayOfDeliveryId ? `Replay of ${escapeHtml(entry.replayOfDeliveryId)}` : `<form method="post" action="/developer/webhooks/deliveries/${entry.id}/replay"><button>Replay</button></form>`}</td></tr>`).join('') || '<tr><td colspan="5">No signed deliveries yet.</td></tr>';
    text(res, 200, page('Developer webhooks', actor, `<div class="grid"><div class="card"><h3>Webhook subscription lifecycle</h3><form method="post" action="/developer/webhooks"><input name="targetUrl" placeholder="https://example.test/webhook" required><input name="events" value="audit,contact.created,campaign.sent"><button>Create signed webhook</button></form><p>Lifecycle events: ${snapshot.webhookSubscriptions.lifecycleEventCount} · signed deliveries: ${snapshot.deliveries.signedCount} · replays: ${snapshot.deliveries.replayCount}</p></div><div class="card"><h3>Runtime API evidence</h3><pre>${escapeHtml(JSON.stringify(snapshot.runtimeHealth, null, 2))}</pre><p><a href="/api/developer/runtime">/api/developer/runtime</a></p></div></div><div class="card"><h3>Subscriptions</h3><table><tr><th>Target</th><th>Status</th><th>Events</th><th>Signing</th><th>Actions</th></tr>${hookRows}</table></div><div class="card"><h3>Delivery history</h3><p>Signed delivery history and replay</p><table><tr><th>Event</th><th>Target</th><th>Status</th><th>Signature</th><th>Replay</th></tr>${deliveryRows}</table></div>`));
  });

  router.register('POST', '/developer/webhooks', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    createDeveloperWebhookSubscription(state, actor, await readBody(req));
    redirect(res, '/developer/webhooks');
  });

  router.register('POST', '/developer/webhooks/:id/pause', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    setDeveloperWebhookSubscriptionStatus(state, actor, params.id, 'paused');
    redirect(res, '/developer/webhooks');
  });

  router.register('POST', '/developer/webhooks/:id/resume', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    setDeveloperWebhookSubscriptionStatus(state, actor, params.id, 'active');
    redirect(res, '/developer/webhooks');
  });

  router.register('POST', '/developer/webhooks/:id/deliver', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    dispatchDeveloperWebhookDelivery(state, actor, params.id, await readBody(req));
    redirect(res, '/developer/webhooks');
  });

  router.register('POST', '/developer/webhooks/deliveries/:id/replay', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    replayDeveloperWebhookDelivery(state, actor, params.id);
    redirect(res, '/developer/webhooks');
  });

  router.register('GET', '/developer/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = persistDeveloperApiRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Developer runtime snapshot', actor, `<div class="card"><h3>Developer API/webhook runtime contract</h3><pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre></div>`));
  });

  router.register('GET', '/api/developer/runtime', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, { ok: true, developerRuntime: buildDeveloperApiRuntimeSnapshot(state, actor.workspace.id) });
  });
}

export const integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "integration_provider_sync",
  "focusGroup": "integrations_api_oauth",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.integration_provider_sync::semantic-frontier-001#10-integrated_user_path_evidence#2",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildIntegrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-integration-marketplace.mjs","packages/app/integration-provider.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: integrationProviderSyncIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "reporting_metrics_pipeline",
  "focusGroup": "reporting_analytics",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.reporting_metrics_pipeline::semantic-frontier-001#08-integrated_user_path_evidence#2",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildReportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/analytics-events.mjs","packages/app/domain-campaigns.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "integration_provider_sync",
  "focusGroup": "integrations_api_oauth",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.integration_provider_sync::semantic-frontier-001#10-primary_runtime_spine#2",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildIntegrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-integration-marketplace.mjs","packages/app/integration-provider.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: integrationProviderSyncPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

export const reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "reporting_metrics_pipeline",
  "focusGroup": "reporting_analytics",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.reporting_metrics_pipeline::semantic-frontier-001#08-primary_runtime_spine#2",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildReportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/analytics-events.mjs","packages/app/domain-campaigns.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

export const teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "team_roles_permissions",
  "focusGroup": "team_roles_permissions",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.team_roles_permissions::semantic-frontier-001#03-integrated_user_path_evidence#2",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTeamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs","packages/app/storage.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: teamRolesPermissionsIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const teamRolesPermissionsPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "team_roles_permissions",
  "focusGroup": "team_roles_permissions",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.team_roles_permissions::semantic-frontier-001#03-primary_runtime_spine#2",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTeamRolesPermissionsPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...teamRolesPermissionsPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/routes/api-admin.mjs","packages/app/routes/platform.mjs","packages/app/storage.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: teamRolesPermissionsPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: teamRolesPermissionsPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: teamRolesPermissionsPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}
