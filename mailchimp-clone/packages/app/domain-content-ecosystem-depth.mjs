import { saveDb } from './storage.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { recordAudit } from './domain-core.mjs';
import { ensureCurrentProductState } from './domain-website-builder.mjs';

export function saveContentSnippet(state, actor, body = {}) {
  ensureCurrentProductState(state);
  const snippet = { id: createId('snippet'), workspaceId: actor.workspace.id, name: body.name || 'Snippet', channel: body.channel || 'email', tags: csvSplit(body.tags), content: body.content || '', createdAt: nowIso(), updatedAt: nowIso() };
  state.db.assetSnippets.unshift(snippet);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-snippet-create', detail: `Saved snippet ${snippet.name}` });
  return snippet;
}

export function saveTemplateVersion(state, actor, templateId, notes = '') {
  ensureCurrentProductState(state);
  const template = state.db.contentTemplates.find((entry) => entry.id === templateId && entry.workspaceId === actor.workspace.id) || state.db.templates.find((entry) => entry.id === templateId);
  if (!template) return null;
  const version = { id: createId('cver'), workspaceId: actor.workspace.id, templateId, templateName: template.name, notes: notes || 'Manual snapshot', blocks: (template.blocks || []).map((block) => ({ ...block })), createdAt: nowIso() };
  state.db.contentVersions.unshift(version);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-version-save', detail: `Saved version for ${template.name}` });
  return version;
}

export function createContentApprovalRequest(state, actor, body = {}) {
  const request = { id: createId('approval'), workspaceId: actor.workspace.id, targetType: body.targetType || 'content_template', targetId: body.targetId || '', title: body.title || 'Content approval', note: body.note || '', approversRequired: Number(body.approversRequired || 1), requestedBy: actor.user.id, status: 'pending', createdAt: nowIso(), updatedAt: nowIso() };
  state.db.approvalRequests.unshift(request);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-approval-request', detail: `Requested approval for ${request.title}` });
  return request;
}

export function contentUsageLineage(state, workspaceId) {
  const assets = state.db.assets.filter((entry) => entry.workspaceId === workspaceId);
  return assets.map((asset) => ({
    asset,
    campaignCount: state.db.campaigns.filter((campaign) => campaign.workspaceId === workspaceId && (campaign.blocks || []).some((block) => block.assetId === asset.id)).length,
    websiteCount: state.db.websitePages.filter((page) => page.workspaceId === workspaceId && (page.body || '').includes(asset.name)).length,
    snippetCount: state.db.assetSnippets.filter((snippet) => snippet.workspaceId === workspaceId && (snippet.content || '').includes(asset.name)).length
  }));
}

export function searchContentWorkspace(state, workspaceId, { q = '', tag = '' } = {}) {
  ensureCurrentProductState(state);
  const query = String(q || '').toLowerCase();
  const wantedTag = String(tag || '').toLowerCase();
  const matchText = (value = '') => !query || String(value || '').toLowerCase().includes(query);
  const matchTags = (tags = []) => !wantedTag || tags.map((entry) => String(entry).toLowerCase()).includes(wantedTag);
  return {
    assets: state.db.assets.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => matchText(`${entry.name} ${entry.folder} ${entry.altText || ''}`) && matchTags(entry.tags || [])),
    templates: [...state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId), ...state.db.templates.map((entry) => ({ ...entry, source: 'system' }))].filter((entry) => matchText(`${entry.name} ${entry.description || ''} ${entry.category || ''}`) && matchTags(entry.tags || [])),
    snippets: state.db.assetSnippets.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => matchText(`${entry.name} ${entry.content}`) && matchTags(entry.tags || []))
  };
}

export function configureIntegrationInstallation(state, actor, installation, body = {}) {
  installation.authStatus = body.authStatus || 'connected';
  installation.accountLabel = body.accountLabel || installation.accountLabel || `${installation.appId} account`;
  installation.health = body.health || 'healthy';
  installation.config = { syncAudienceId: body.syncAudienceId || installation.config?.syncAudienceId || '', syncOrders: body.syncOrders === 'off' ? false : true, syncProducts: body.syncProducts === 'off' ? false : true, syncLeads: body.syncLeads === 'off' ? false : true };
  installation.updatedAt = nowIso();
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-configure', detail: `Configured ${installation.appId}` });
  return installation;
}

export function updateIntegrationMapping(state, actor, installation, body = {}) {
  installation.mapping = { email: body.email || installation.mapping?.email || 'email', phone: body.phone || installation.mapping?.phone || 'phone', tags: body.tags || installation.mapping?.tags || 'tags', lifecycleStage: body.lifecycleStage || installation.mapping?.lifecycleStage || 'status', consent: body.consent || installation.mapping?.consent || 'marketing_consent' };
  installation.health ||= 'healthy';
  installation.updatedAt = nowIso();
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-field-mapping', detail: `Updated mapping for ${installation.appId}` });
  return installation.mapping;
}

export function flagIntegrationIssue(state, actor, installation, detail = 'Sync retry required') {
  installation.health = 'degraded';
  installation.lastIssue = detail;
  installation.updatedAt = nowIso();
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-issue-flag', detail: `${installation.appId}: ${detail}` });
  return installation;
}

export function connectorSummary(installation) {
  return { authStatus: installation.authStatus || 'pending', health: installation.health || 'healthy', mappingReady: Boolean(installation.mapping?.email), lastIssue: installation.lastIssue || null, config: installation.config || { syncAudienceId: '', syncOrders: true, syncProducts: true, syncLeads: true } };
}
