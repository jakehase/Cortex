import { page } from '../view.mjs';
import { escapeHtml, readBody, redirect, text } from '../utils.mjs';
import { addSuppressionEntry, buildSettingsDomainsDeliverabilityRuntimeSnapshot, deliverabilityHealth, ensureComplianceAlerts, persistSettingsDomainsDeliverabilityRuntimeSnapshot, recordDedicatedIpReadinessEvent, recordDmarcAlignmentEvent, recordDomainDnsAuthenticationCheck, recordSenderReputationWarmupEvent, resolveComplianceAlert, runDeliverabilityComplianceReview } from '../domain-deliverability-compliance.mjs';

export function registerDeliverabilityComplianceRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/deliverability', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    ensureComplianceAlerts(state, actor);
    const health = deliverabilityHealth(state, actor.workspace.id);
    const alerts = state.db.complianceAlerts.filter((entry) => entry.workspaceId === actor.workspace.id);
    const suppressions = state.db.suppressionEntries.filter((entry) => entry.workspaceId === actor.workspace.id);
    const domains = actor.workspace.settings.domains || [];
    const runtime = buildSettingsDomainsDeliverabilityRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Deliverability compliance center', actor, `<div class="grid"><div class="card"><h3>Inbox readiness</h3><p><strong>Score:</strong> ${health.score}</p><p><strong>Band:</strong> ${health.inboxPlacementBand}</p><ul>${health.checklist.map((item) => `<li>${escapeHtml(item.label)}: ${item.ok ? 'ok' : 'needs work'}</li>`).join('')}</ul><p><a href="/deliverability/runtime/snapshot">Persist deliverability runtime snapshot</a> · <a href="/api/deliverability/runtime">Runtime API JSON</a></p></div><div class="card"><h3>Settings domains deliverability runtime</h3><p>${escapeHtml(runtime.label)}</p><pre>${escapeHtml(JSON.stringify(runtime.runtimeHealth, null, 2))}</pre></div><div class="card"><h3>Suppress recipient</h3><form method="post" action="/deliverability/suppressions"><input name="email" type="email" placeholder="bounce@example.com" required><input name="reason" value="hard_bounce"><button>Add suppression</button></form><p>Suppression entries: ${health.suppressionCount}</p></div></div><div class="grid" style="margin-top:16px"><div class="card"><h3>DNS authentication and DMARC</h3><form method="post" action="/deliverability/dns-check"><select name="domainId">${domains.map((domain) => `<option value="${escapeHtml(domain.id)}">${escapeHtml(domain.name)}</option>`).join('')}</select><button>Run DNS auth check</button></form><form method="post" action="/deliverability/dmarc"><select name="domainId">${domains.map((domain) => `<option value="${escapeHtml(domain.id)}">${escapeHtml(domain.name)}</option>`).join('')}</select><select name="policy"><option value="quarantine">quarantine</option><option value="reject">reject</option></select><button>Record DMARC alignment</button></form></div><div class="card"><h3>Reputation and IP readiness</h3><form method="post" action="/deliverability/warmup"><input name="stage" value="ramp_week_1"><input name="dailyCap" type="number" value="500"><button>Record warmup</button></form><form method="post" action="/deliverability/dedicated-ip"><input name="poolId" value="pool-primary"><input name="reverseDnsStatus" value="aligned"><button>Record dedicated IP readiness</button></form><form method="post" action="/deliverability/compliance-review"><button>Run compliance review</button></form></div></div><div class="card"><h3>Domain reputation & authentication</h3><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>DMARC</th><th>Default</th></tr>${domains.map((domain) => `<tr><td>${escapeHtml(domain.name)}</td><td>${escapeHtml(domain.verificationStatus)}</td><td>${escapeHtml(domain.authenticationStatus)}</td><td>${escapeHtml(domain.dmarcPolicy || 'not checked')}</td><td>${domain.isDefault ? 'yes' : 'no'}</td></tr>`).join('') || '<tr><td colspan="5">Connect domains from Settings.</td></tr>'}</table></div><div class="card"><h3>Compliance alerts</h3><table><tr><th>Alert</th><th>Severity</th><th>Status</th><th>Action</th></tr>${alerts.map((alert) => `<tr><td>${escapeHtml(alert.title)}<div class="muted">${escapeHtml(alert.detail)}</div></td><td>${escapeHtml(alert.severity)}</td><td>${escapeHtml(alert.status)}</td><td>${alert.status === 'resolved' ? 'resolved' : `<form method="post" action="/deliverability/alerts/${alert.id}/resolve"><button>Resolve</button></form>`}</td></tr>`).join('')}</table></div><div class="card"><h3>Suppression list</h3><table><tr><th>Email</th><th>Reason</th><th>Source</th></tr>${suppressions.map((entry) => `<tr><td>${escapeHtml(entry.email)}</td><td>${escapeHtml(entry.reason)}</td><td>${escapeHtml(entry.source)}</td></tr>`).join('') || '<tr><td colspan="3">No suppressed contacts yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/deliverability/suppressions', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    addSuppressionEntry(state, actor, await readBody(req));
    redirect(res, '/deliverability');
  });

  router.register('POST', '/deliverability/alerts/:id/resolve', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const alert = state.db.complianceAlerts.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (alert) resolveComplianceAlert(state, actor, alert);
    redirect(res, '/deliverability');
  });

  router.register('POST', '/deliverability/dns-check', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDomainDnsAuthenticationCheck(state, actor, await readBody(req));
    redirect(res, '/deliverability');
  });

  router.register('POST', '/deliverability/dmarc', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDmarcAlignmentEvent(state, actor, await readBody(req));
    redirect(res, '/deliverability');
  });

  router.register('POST', '/deliverability/warmup', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordSenderReputationWarmupEvent(state, actor, await readBody(req));
    redirect(res, '/deliverability');
  });

  router.register('POST', '/deliverability/dedicated-ip', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDedicatedIpReadinessEvent(state, actor, await readBody(req));
    redirect(res, '/deliverability');
  });

  router.register('POST', '/deliverability/compliance-review', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    runDeliverabilityComplianceReview(state, actor, await readBody(req));
    redirect(res, '/deliverability');
  });

  router.register('GET', '/deliverability/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = persistSettingsDomainsDeliverabilityRuntimeSnapshot(state, actor, 'deliverability_runtime_page');
    text(res, 200, page('Deliverability runtime snapshot', actor, `<div class="card"><h3>Settings domains deliverability runtime snapshot</h3><pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre></div>`));
  });
}
