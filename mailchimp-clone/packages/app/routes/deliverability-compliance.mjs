import { page } from '../view.mjs';
import { readBody, redirect, text } from '../utils.mjs';
import { addSuppressionEntry, deliverabilityHealth, ensureComplianceAlerts, resolveComplianceAlert } from '../domain-deliverability-compliance.mjs';

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
    text(res, 200, page('Deliverability compliance center', actor, `<div class="grid"><div class="card"><h3>Inbox readiness</h3><p><strong>Score:</strong> ${health.score}</p><p><strong>Band:</strong> ${health.inboxPlacementBand}</p><ul>${health.checklist.map((item) => `<li>${item.label}: ${item.ok ? 'ok' : 'needs work'}</li>`).join('')}</ul></div><div class="card"><h3>Suppress recipient</h3><form method="post" action="/deliverability/suppressions"><input name="email" type="email" placeholder="bounce@example.com" required><input name="reason" value="hard_bounce"><button>Add suppression</button></form><p>Suppression entries: ${health.suppressionCount}</p></div></div><div class="card"><h3>Domain reputation & authentication</h3><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th></tr>${domains.map((domain) => `<tr><td>${domain.name}</td><td>${domain.verificationStatus}</td><td>${domain.authenticationStatus}</td><td>${domain.isDefault ? 'yes' : 'no'}</td></tr>`).join('') || '<tr><td colspan="4">Connect domains from Settings.</td></tr>'}</table></div><div class="card"><h3>Compliance alerts</h3><table><tr><th>Alert</th><th>Severity</th><th>Status</th><th>Action</th></tr>${alerts.map((alert) => `<tr><td>${alert.title}<div class="muted">${alert.detail}</div></td><td>${alert.severity}</td><td>${alert.status}</td><td>${alert.status === 'resolved' ? 'resolved' : `<form method="post" action="/deliverability/alerts/${alert.id}/resolve"><button>Resolve</button></form>`}</td></tr>`).join('')}</table></div><div class="card"><h3>Suppression list</h3><table><tr><th>Email</th><th>Reason</th><th>Source</th></tr>${suppressions.map((entry) => `<tr><td>${entry.email}</td><td>${entry.reason}</td><td>${entry.source}</td></tr>`).join('') || '<tr><td colspan="3">No suppressed contacts yet.</td></tr>'}</table></div>`));
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
}
