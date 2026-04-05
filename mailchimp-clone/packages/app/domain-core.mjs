import { createAudience, createWorkspace, PLAN_CATALOG, saveDb, writeExport, writeUpload } from './storage.mjs';
import { createId, csvSplit, formArray, hashPassword, normalizeDomainName, nowIso, parseCookies } from './utils.mjs';
import { createSession, getSessionFromRequest } from './security.mjs';

export function planFor(workspace) {
  return PLAN_CATALOG.find((plan) => plan.id === workspace.planId) || PLAN_CATALOG[0];
}

export function hasFeature(workspace, key) {
  return Boolean(planFor(workspace).features[key]) || ['automations', 'forms', 'landingPages', 'reports', 'webhooks', 'apiAccess', 'integrationsMarketplace', 'commerceInsights', 'approvals', 'complianceCenter', 'contentStudioTemplates'].includes(key);
}

export function findUserByEmail(state, email) {
  return state.db.users.find((user) => user.email.toLowerCase() === String(email || '').toLowerCase());
}

export function membershipsForUser(state, userId) {
  return state.db.memberships.filter((membership) => membership.userId === userId && membership.status === 'active');
}

export function actorFromUser(state, user) {
  if (!user) return null;
  const memberships = membershipsForUser(state, user.id);
  const membership = memberships.find((entry) => entry.workspaceId === user.activeWorkspaceId) || memberships[0];
  if (!membership) return null;
  const workspace = state.db.workspaces.find((entry) => entry.id === membership.workspaceId);
  if (!workspace) return null;
  return { user, workspace, membership, memberships };
}

export function getCurrentActor(state, req) {
  const session = getSessionFromRequest(state, req);
  if (!session) return null;
  return actorFromUser(state, state.db.users.find((entry) => entry.id === session.userId));
}

export function apiActor(state, req) {
  const viaSession = getCurrentActor(state, req);
  if (viaSession) return viaSession;
  const auth = req.headers.authorization || req.headers['x-api-key'];
  if (!auth) return null;
  const token = String(auth).startsWith('Bearer ') ? String(auth).slice(7) : String(auth);
  const workspace = state.db.workspaces.find((entry) => entry.apiKey === token) || state.db.workspaces.find((entry) => state.db.apiKeys.some((key) => key.workspaceId === entry.id && key.token === token && !key.revokedAt));
  if (!workspace) return null;
  const membership = state.db.memberships.find((entry) => entry.workspaceId === workspace.id && entry.status === 'active');
  const user = membership ? state.db.users.find((entry) => entry.id === membership.userId) : null;
  return user && membership ? { user, workspace, membership, memberships: membershipsForUser(state, user.id) } : null;
}

export function recordEvent(state, { workspaceId, type, message, level = 'info', meta = {} }) {
  state.db.events.unshift({ id: createId('event'), workspaceId, type, message, level, meta, createdAt: nowIso() });
  const hooks = state.db.webhooks.filter((hook) => hook.workspaceId === workspaceId && hook.status === 'active');
  for (const hook of hooks) {
    state.db.webhookDeliveries.unshift({ id: createId('whd'), workspaceId, webhookId: hook.id, eventType: type, targetUrl: hook.targetUrl, payload: { type, message, meta }, status: 'delivered', createdAt: nowIso() });
  }
}

export function createNotification(state, { workspaceId, type, payload }) {
  const note = { id: createId('note'), workspaceId, type, payload, createdAt: nowIso(), status: 'sent' };
  state.db.notifications.unshift(note);
  recordEvent(state, { workspaceId, type: `notification:${type}`, message: `${type} notification created`, meta: payload });
  return note;
}

export function recordAudit(state, { workspaceId, userId, action, detail }) {
  state.db.auditEvents.unshift({ id: createId('audit'), workspaceId, userId, action, detail, createdAt: nowIso() });
  recordEvent(state, { workspaceId, type: 'audit', message: `${action}: ${detail}`, meta: { userId } });
  saveDb(state.db);
}

export function enqueueJob(state, { type, workspaceId, userId, payload, runAt }) {
  const job = { id: createId('job'), type, workspaceId, userId, payload, status: 'pending', createdAt: nowIso(), updatedAt: nowIso(), runAt: runAt || nowIso(), result: null };
  state.db.jobs.unshift(job);
  recordEvent(state, { workspaceId, type: 'job-queued', message: `${type} queued`, meta: { jobId: job.id } });
  saveDb(state.db);
  return job;
}

export function createAccount(state, { name, email, password, workspaceName }, req) {
  const workspace = createWorkspace(workspaceName, name);
  const user = { id: createId('user'), name, email, passwordHash: hashPassword(password), activeWorkspaceId: workspace.id, createdAt: nowIso() };
  state.db.workspaces.push(workspace);
  state.db.users.push(user);
  state.db.memberships.push({ id: createId('mship'), userId: user.id, workspaceId: workspace.id, role: 'owner', status: 'active', createdAt: nowIso() });
  state.db.audiences.push(createAudience(workspace.id, 'Main audience'));
  state.db.apiKeys.unshift({ id: createId('apikey'), workspaceId: workspace.id, label: 'Default workspace key', token: workspace.apiKey, createdBy: user.id, createdAt: nowIso(), revokedAt: null });
  const session = createSession(state, user, req, { reason: 'signup' });
  createNotification(state, { workspaceId: workspace.id, type: 'account-created', payload: { email: user.email, workspaceName: workspace.name } });
  recordAudit(state, { workspaceId: workspace.id, userId: user.id, action: 'signup', detail: `Created workspace ${workspace.name}` });
  return { user, workspace, session };
}

export function createWorkspaceForUser(state, actor, name) {
  const workspace = createWorkspace(name, actor.user.name);
  state.db.workspaces.push(workspace);
  state.db.memberships.push({ id: createId('mship'), userId: actor.user.id, workspaceId: workspace.id, role: 'owner', status: 'active', createdAt: nowIso() });
  state.db.audiences.push(createAudience(workspace.id, 'Main audience'));
  state.db.apiKeys.unshift({ id: createId('apikey'), workspaceId: workspace.id, label: 'Default workspace key', token: workspace.apiKey, createdBy: actor.user.id, createdAt: nowIso(), revokedAt: null });
  actor.user.activeWorkspaceId = workspace.id;
  saveDb(state.db);
  recordAudit(state, { workspaceId: workspace.id, userId: actor.user.id, action: 'workspace-create', detail: `Created workspace ${workspace.name}` });
}

export function applyBillingPlan(state, actor, planId) {
  actor.workspace.planId = planId;
  actor.workspace.billing.currentPlan = planId;
  actor.workspace.billing.invoices.unshift({ id: createId('inv'), amount: planId === 'starter' ? '$0' : planId === 'growth' ? '$49' : '$149', status: 'pending', createdAt: nowIso() });
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-plan-change', detail: `Plan changed to ${planId}` });
}

export function updateSettings(state, actor, body) {
  actor.workspace.settings = { senderName: body.senderName, senderEmail: body.senderEmail, replyTo: body.replyTo, timezone: body.timezone, address: body.address, brandColor: body.brandColor, domains: actor.workspace.settings.domains || [] };
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'settings-update', detail: 'Updated workspace settings' });
}

export function addDomain(state, actor, domainInput) {
  const name = normalizeDomainName(domainInput);
  actor.workspace.settings.domains ||= [];
  if (!actor.workspace.settings.domains.some((entry) => entry.name === name)) {
    actor.workspace.settings.domains.unshift({ id: createId('domain'), name, verificationStatus: 'pending', authenticationStatus: 'pending', isDefault: actor.workspace.settings.domains.length === 0, createdAt: nowIso() });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'domain-add', detail: `Added sending domain ${name}` });
  }
}

export function storeAsset(state, actor, body) {
  const assetId = createId('asset');
  const storagePath = writeUpload(assetId, body.body || '');
  state.db.assets.unshift({ id: assetId, workspaceId: actor.workspace.id, name: body.name, folder: body.folder || 'Root', contentType: body.contentType || 'text/plain', altText: body.altText || '', storagePath, usageCount: 0, createdBy: actor.user.id, createdAt: nowIso() });
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'asset-upload', detail: `Stored asset ${body.name}` });
}

export function createExport(state, actor, label, body) {
  const exportId = createId('export');
  const storagePath = writeExport(exportId, body);
  const entry = { id: exportId, workspaceId: actor.workspace.id, label, createdBy: actor.user.id, createdAt: nowIso(), storagePath };
  state.db.exports.unshift(entry);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'state-export', detail: `Generated export ${label}` });
  return entry;
}

export function formIds(body, key) {
  return formArray(body, key);
}

export function contactPayload(body) {
  return { firstName: body.firstName || '', lastName: body.lastName || '', email: body.email || '', status: body.status || 'subscribed', tags: csvSplit(body.tags), interests: csvSplit(body.interests), groups: body.groupCategory && body.groupValue ? { [body.groupCategory]: body.groupValue } : {}, notes: body.notes || '', phone: body.phone || '' };
}
