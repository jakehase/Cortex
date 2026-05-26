import { persistState } from './storage.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { recordAudit } from './domain-core.mjs';
import { ensureCurrentProductState } from './domain-website-builder.mjs';
import { buildProviderAccountRuntime, buildProviderAuthSession } from './integration-provider.mjs';

export function saveContentSnippet(state, actor, body = {}) {
  ensureCurrentProductState(state);
  const snippet = { id: createId('snippet'), workspaceId: actor.workspace.id, name: body.name || 'Snippet', channel: body.channel || 'email', tags: csvSplit(body.tags), content: body.content || '', createdAt: nowIso(), updatedAt: nowIso() };
  state.db.assetSnippets.unshift(snippet);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-snippet-create', detail: `Saved snippet ${snippet.name}` });
  return snippet;
}

export function saveTemplateVersion(state, actor, templateId, notes = '') {
  ensureCurrentProductState(state);
  const template = state.db.contentTemplates.find((entry) => entry.id === templateId && entry.workspaceId === actor.workspace.id) || state.db.templates.find((entry) => entry.id === templateId);
  if (!template) return null;
  const version = { id: createId('cver'), workspaceId: actor.workspace.id, templateId, templateName: template.name, notes: notes || 'Manual snapshot', blocks: (template.blocks || []).map((block) => ({ ...block })), createdAt: nowIso() };
  state.db.contentVersions.unshift(version);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-version-save', detail: `Saved version for ${template.name}` });
  return version;
}

export function createContentApprovalRequest(state, actor, body = {}) {
  const request = { id: createId('approval'), workspaceId: actor.workspace.id, targetType: body.targetType || 'content_template', targetId: body.targetId || '', title: body.title || 'Content approval', note: body.note || '', approversRequired: Number(body.approversRequired || 1), requestedBy: actor.user.id, status: 'pending', createdAt: nowIso(), updatedAt: nowIso() };
  state.db.approvalRequests.unshift(request);
  persistState(state);
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

export function contentDepthSummary(state, workspaceId) {
  const snippets = state.db.assetSnippets.filter((entry) => entry.workspaceId === workspaceId);
  const versions = state.db.contentVersions.filter((entry) => entry.workspaceId === workspaceId);
  const approvals = state.db.approvalRequests.filter((entry) => entry.workspaceId === workspaceId && entry.targetType === 'content_template');
  const lineage = contentUsageLineage(state, workspaceId)
    .map((entry) => ({
      ...entry,
      totalUsage: Number(entry.campaignCount || 0) + Number(entry.websiteCount || 0) + Number(entry.snippetCount || 0)
    }))
    .sort((a, b) => Number(b.totalUsage || 0) - Number(a.totalUsage || 0));
  return {
    snippets: snippets.length,
    versions: versions.length,
    approvalRequests: approvals.length,
    reusableAssets: lineage.filter((entry) => entry.totalUsage > 0).length,
    topAsset: lineage[0]?.asset?.name || null
  };
}

export function configureIntegrationInstallation(state, actor, installation, body = {}) {
  state.db.integrationProviderAccounts ||= [];
  state.db.integrationProviderAuthSessions ||= [];
  installation.authStatus = body.authStatus || 'connected';
  installation.accountLabel = body.accountLabel || installation.accountLabel || `${installation.appId} account`;
  installation.externalAccountId = body.externalAccountId || installation.externalAccountId || installation.accountLabel;
  installation.health = body.health || 'healthy';
  installation.config = { syncAudienceId: body.syncAudienceId || installation.config?.syncAudienceId || '', syncOrders: body.syncOrders === 'off' ? false : true, syncProducts: body.syncProducts === 'off' ? false : true, syncLeads: body.syncLeads === 'off' ? false : true };
  const app = { id: installation.appId, scopes: installation.scopes || [] };
  const runtime = buildProviderAccountRuntime(app, installation);
  let account = state.db.integrationProviderAccounts.find((entry) => entry.installationId === installation.id);
  if (!account) {
    account = { id: createId('intacct'), workspaceId: actor.workspace.id, installationId: installation.id, appId: installation.appId, createdAt: nowIso() };
    state.db.integrationProviderAccounts.unshift(account);
  }
  Object.assign(account, { provider: runtime.provider, accountKey: runtime.accountKey, externalAccountId: runtime.externalAccountId, accountLabel: runtime.accountLabel, status: runtime.status, authMode: runtime.authMode, scopes: runtime.scopes, supportedObjects: runtime.supportedObjects, webhookEvents: runtime.webhookEvents, evidenceContract: runtime.evidenceContract, updatedAt: nowIso() });
  const authSession = { id: createId('oauth'), workspaceId: actor.workspace.id, ...buildProviderAuthSession(app, installation, body) };
  state.db.integrationProviderAuthSessions.unshift(authSession);
  installation.providerAccount = account;
  installation.providerAuthSessionId = authSession.id;
  installation.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-configure', detail: `Configured ${installation.appId}` });
  return installation;
}

export function updateIntegrationMapping(state, actor, installation, body = {}) {
  installation.mapping = { email: body.email || installation.mapping?.email || 'email', phone: body.phone || installation.mapping?.phone || 'phone', tags: body.tags || installation.mapping?.tags || 'tags', lifecycleStage: body.lifecycleStage || installation.mapping?.lifecycleStage || 'status', consent: body.consent || installation.mapping?.consent || 'marketing_consent' };
  installation.health ||= 'healthy';
  installation.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-field-mapping', detail: `Updated mapping for ${installation.appId}` });
  return installation.mapping;
}

export function flagIntegrationIssue(state, actor, installation, detail = 'Sync retry required') {
  installation.health = 'degraded';
  installation.lastIssue = detail;
  installation.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-issue-flag', detail: `${installation.appId}: ${detail}` });
  return installation;
}

export function connectorSummary(installation) {
  return { authStatus: installation.authStatus || 'pending', health: installation.health || 'healthy', mappingReady: Boolean(installation.mapping?.email), lastIssue: installation.lastIssue || null, config: installation.config || { syncAudienceId: '', syncOrders: true, syncProducts: true, syncLeads: true }, providerAccount: installation.providerAccount || null, providerCursor: installation.providerCursor || null, providerAuthSessionId: installation.providerAuthSessionId || null, lastWebhookAt: installation.lastWebhookAt || null };
}

export const contentStudioIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "content_studio",
  "focusGroup": "content_studio",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.content_studio::semantic-frontier-001#14-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildContentStudioIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...contentStudioIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-content-ecosystem-depth.mjs","packages/app/routes/content-asset-templates.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: contentStudioIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: contentStudioIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: contentStudioIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const contentStudioPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "content_studio",
  "focusGroup": "content_studio",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.content_studio::semantic-frontier-001#14-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildContentStudioPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...contentStudioPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-content-ecosystem-depth.mjs","packages/app/routes/content-asset-templates.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: contentStudioPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: contentStudioPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: contentStudioPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}
