import { saveDb } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';

function workspaceAlerts(state, workspaceId) {
  return state.db.complianceAlerts.filter((entry) => entry.workspaceId === workspaceId);
}

export function ensureComplianceAlerts(state, actor) {
  const workspace = actor.workspace;
  const alerts = workspaceAlerts(state, workspace.id);
  if (alerts.length) return alerts;
  const seeded = [
    { id: createId('alert'), workspaceId: workspace.id, type: 'sender_profile', severity: 'medium', status: 'open', title: 'Sender profile review', detail: 'Verify sender email, reply-to, and physical address before high-volume sends.', createdAt: nowIso(), resolvedAt: null },
    { id: createId('alert'), workspaceId: workspace.id, type: 'domain_authentication', severity: 'high', status: 'open', title: 'Authenticate a sending domain', detail: 'Connect and authenticate at least one sending domain for optimal inbox placement.', createdAt: nowIso(), resolvedAt: null },
    { id: createId('alert'), workspaceId: workspace.id, type: 'suppression_hygiene', severity: 'low', status: 'open', title: 'Review suppression hygiene', detail: 'Suppress bounced or opted-out recipients before next send.', createdAt: nowIso(), resolvedAt: null }
  ];
  state.db.complianceAlerts.unshift(...seeded);
  saveDb(state.db);
  return seeded;
}

export function deliverabilityChecklist(workspace) {
  const domains = workspace.settings.domains || [];
  return [
    { id: 'sender_email', label: 'Sender email configured', ok: Boolean(workspace.settings.senderEmail) },
    { id: 'physical_address', label: 'Physical address configured', ok: Boolean(workspace.settings.address) },
    { id: 'verified_domain', label: 'Verified sending domain connected', ok: domains.some((entry) => entry.verificationStatus === 'verified') },
    { id: 'authenticated_domain', label: 'Authenticated sending domain connected', ok: domains.some((entry) => entry.authenticationStatus === 'authenticated') },
    { id: 'default_domain', label: 'Default sending domain selected', ok: domains.some((entry) => entry.isDefault) }
  ];
}

export function deliverabilityHealth(state, workspaceId) {
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId);
  const alerts = workspaceAlerts(state, workspaceId);
  const unresolved = alerts.filter((entry) => entry.status !== 'resolved');
  const checklist = deliverabilityChecklist(workspace);
  const checklistScore = checklist.filter((entry) => entry.ok).length * 18;
  const alertPenalty = unresolved.length * 8;
  const suppressionCount = state.db.suppressionEntries.filter((entry) => entry.workspaceId === workspaceId).length;
  const score = Math.max(42, Math.min(99, checklistScore + 20 - alertPenalty - Math.min(suppressionCount * 2, 10)));
  return {
    score,
    unresolvedAlerts: unresolved.length,
    suppressionCount,
    checklist,
    inboxPlacementBand: score >= 85 ? 'strong' : score >= 70 ? 'monitoring' : 'needs_attention'
  };
}

export function addSuppressionEntry(state, actor, body) {
  const email = String(body.email || '').toLowerCase().trim();
  const existing = state.db.suppressionEntries.find((entry) => entry.workspaceId === actor.workspace.id && entry.email === email);
  if (existing) return existing;
  const entry = {
    id: createId('suppression'),
    workspaceId: actor.workspace.id,
    email,
    reason: body.reason || 'manual_review',
    source: body.source || 'deliverability_center',
    createdAt: nowIso()
  };
  state.db.suppressionEntries.unshift(entry);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'suppression-add', detail: `Suppressed ${email}` });
  createNotification(state, { workspaceId: actor.workspace.id, type: 'suppression-added', payload: { email, reason: entry.reason } });
  return entry;
}

export function resolveComplianceAlert(state, actor, alert) {
  alert.status = 'resolved';
  alert.resolvedAt = nowIso();
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'compliance-alert-resolve', detail: `Resolved ${alert.type}` });
  recordEvent(state, { workspaceId: actor.workspace.id, type: 'compliance-alert-resolved', message: `Resolved ${alert.title}`, meta: { alertId: alert.id } });
  return alert;
}
