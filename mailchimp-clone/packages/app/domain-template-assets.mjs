import { persistState } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { recordAudit } from './domain-core.mjs';

export const CONTENT_STUDIO_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'content_studio_template_asset_runtime_layer',
  label: 'Content studio template and asset lifecycle runtime evidence layer',
  controls: [
    'content_asset_lifecycle_ledger',
    'template_review_lineage_ledger',
    'brand_governance_event_ledger',
    'content_usage_telemetry_events',
    'content_runtime_snapshots',
    'workspace_content_runtime_api'
  ],
  evidenceContract: [
    'asset_lifecycle_approval_ledger',
    'template_review_lineage',
    'brand_kit_governance_checks',
    'content_usage_telemetry',
    'normal_content_route_adoption'
  ]
});

function ensureContentRuntimeCollections(db) {
  db.brandKits ||= [];
  db.contentTemplates ||= [];
  db.templateCollections ||= [];
  db.assets ||= [];
  db.templates ||= [];
  db.contentRuntimeSnapshots ||= [];
  db.contentAssetLifecycleEvents ||= [];
  db.contentTemplateReviewEvents ||= [];
  db.contentUsageTelemetryEvents ||= [];
  db.contentGovernanceEvents ||= [];
}

function parseJsonObject(value = {}) {
  if (value && typeof value === 'object') return value;
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
  } catch {
    return { note: raw };
  }
}

function splitList(value = '') {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function findWorkspaceAsset(state, workspaceId, body = {}) {
  ensureContentRuntimeCollections(state.db);
  return state.db.assets.find((entry) => entry.workspaceId === workspaceId && (entry.id === body.assetId || entry.name === body.assetName)) || null;
}

function findWorkspaceTemplate(state, workspaceId, body = {}) {
  ensureContentRuntimeCollections(state.db);
  return state.db.contentTemplates.find((entry) => entry.workspaceId === workspaceId && (entry.id === body.templateId || entry.name === body.templateName))
    || state.db.templates.find((entry) => entry.id === body.templateId || entry.name === body.templateName)
    || null;
}

export function ensureBrandKit(state, actor) {
  ensureContentRuntimeCollections(state.db);
  const existing = state.db.brandKits.find((entry) => entry.workspaceId === actor.workspace.id);
  if (existing) return existing;
  const brandKit = {
    id: createId('brandkit'),
    workspaceId: actor.workspace.id,
    name: `${actor.workspace.name} brand kit`,
    logoAssetName: '',
    primaryColor: actor.workspace.settings.brandColor || '#0b5fff',
    secondaryColor: '#18212f',
    headingFont: 'Arial',
    bodyFont: 'Arial',
    updatedAt: nowIso()
  };
  state.db.brandKits.unshift(brandKit);
  persistState(state);
  return brandKit;
}

export function workspaceContentTemplates(state, workspaceId) {
  ensureContentRuntimeCollections(state.db);
  return [
    ...state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId),
    ...state.db.templates.map((entry) => ({ ...entry, workspaceId, source: 'system' }))
  ];
}

export function contentStudioSummary(state, workspaceId) {
  ensureContentRuntimeCollections(state.db);
  return {
    brandKits: state.db.brandKits.filter((entry) => entry.workspaceId === workspaceId).length,
    savedTemplates: state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).length,
    collections: state.db.templateCollections.filter((entry) => entry.workspaceId === workspaceId).length,
    assets: state.db.assets.filter((entry) => entry.workspaceId === workspaceId).length
  };
}

export function templateLibrarySummary(state, workspaceId) {
  ensureContentRuntimeCollections(state.db);
  const workspaceTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId);
  const systemTemplates = state.db.templates || [];
  const categories = Array.from(new Set([...workspaceTemplates, ...systemTemplates].map((entry) => entry.category || 'general')));
  return {
    workspaceTemplates: workspaceTemplates.length,
    systemTemplates: systemTemplates.length,
    collections: state.db.templateCollections.filter((entry) => entry.workspaceId === workspaceId).length,
    categories: categories.slice(0, 6)
  };
}

export function createTemplateCollection(state, actor, body) {
  ensureContentRuntimeCollections(state.db);
  const collection = {
    id: createId('collection'),
    workspaceId: actor.workspace.id,
    name: body.name || 'Campaign collection',
    purpose: body.purpose || 'Reusable email assets',
    assetNames: String(body.assetNames || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    createdAt: nowIso()
  };
  state.db.templateCollections.unshift(collection);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'template-collection-create', detail: `Created collection ${collection.name}` });
  return collection;
}

export function saveContentTemplate(state, actor, body) {
  ensureContentRuntimeCollections(state.db);
  const baseTemplate = state.db.templates.find((entry) => entry.id === body.baseTemplateId) || state.db.templates[0];
  const template = {
    id: createId('ctmpl'),
    workspaceId: actor.workspace.id,
    source: 'workspace',
    name: body.name || `${baseTemplate.name} variant`,
    category: body.category || baseTemplate.category,
    description: body.description || `Saved from ${baseTemplate.name}`,
    channel: body.channel || 'email',
    baseTemplateId: baseTemplate.id,
    blocks: baseTemplate.blocks.map((block) => ({ ...block })),
    createdAt: nowIso()
  };
  state.db.contentTemplates.unshift(template);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-template-save', detail: `Saved template ${template.name}` });
  return template;
}

export function updateBrandKit(state, actor, body) {
  ensureContentRuntimeCollections(state.db);
  const brandKit = ensureBrandKit(state, actor);
  Object.assign(brandKit, {
    name: body.name || brandKit.name,
    logoAssetName: body.logoAssetName || brandKit.logoAssetName,
    primaryColor: body.primaryColor || brandKit.primaryColor,
    secondaryColor: body.secondaryColor || brandKit.secondaryColor,
    headingFont: body.headingFont || brandKit.headingFont,
    bodyFont: body.bodyFont || brandKit.bodyFont,
    updatedAt: nowIso()
  });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'brand-kit-update', detail: `Updated brand kit ${brandKit.name}` });
  return brandKit;
}

export function recordContentAssetLifecycleEvent(state, actor, body = {}) {
  ensureContentRuntimeCollections(state.db);
  const asset = findWorkspaceAsset(state, actor.workspace.id, body);
  const event = {
    id: createId('assetlife'),
    workspaceId: actor.workspace.id,
    assetId: asset?.id || body.assetId || '',
    assetName: asset?.name || body.assetName || 'Unmatched asset',
    folder: asset?.folder || body.folder || 'Root',
    action: body.action || 'approved_for_use',
    status: body.status || 'approved',
    reviewerId: actor.user.id,
    metadata: parseJsonObject(body.metadata),
    recordedAt: nowIso()
  };
  state.db.contentAssetLifecycleEvents.unshift(event);
  state.db.contentAssetLifecycleEvents = state.db.contentAssetLifecycleEvents.slice(0, 1000);
  if (asset) {
    asset.lifecycleStatus = event.status;
    asset.lifecycleAction = event.action;
    asset.lifecycleEventId = event.id;
    asset.usageCount = Number(asset.usageCount || 0) + (event.action === 'used_in_campaign' ? 1 : 0);
    asset.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-asset-lifecycle', detail: `${event.action} for asset ${event.assetName}` });
  return event;
}

export function recordContentTemplateReviewEvent(state, actor, body = {}) {
  ensureContentRuntimeCollections(state.db);
  const template = findWorkspaceTemplate(state, actor.workspace.id, body);
  const event = {
    id: createId('tmplreview'),
    workspaceId: actor.workspace.id,
    templateId: template?.id || body.templateId || '',
    templateName: template?.name || body.templateName || 'Unmatched template',
    source: template?.source || (template && state.db.templates.some((entry) => entry.id === template.id) ? 'system' : 'workspace'),
    baseTemplateId: template?.baseTemplateId || body.baseTemplateId || null,
    reviewStage: body.reviewStage || 'brand_review',
    decision: body.decision || 'approved',
    reviewerId: actor.user.id,
    comments: body.comments || '',
    lineage: {
      baseTemplateId: template?.baseTemplateId || body.baseTemplateId || null,
      blocks: Array.isArray(template?.blocks) ? template.blocks.length : 0,
      category: template?.category || body.category || 'general'
    },
    recordedAt: nowIso()
  };
  state.db.contentTemplateReviewEvents.unshift(event);
  state.db.contentTemplateReviewEvents = state.db.contentTemplateReviewEvents.slice(0, 1000);
  if (template && template.workspaceId === actor.workspace.id) {
    template.reviewStatus = event.decision;
    template.reviewStage = event.reviewStage;
    template.lastReviewEventId = event.id;
    template.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-template-review', detail: `${event.decision} template ${event.templateName}` });
  return event;
}

export function recordContentUsageTelemetryEvent(state, actor, body = {}) {
  ensureContentRuntimeCollections(state.db);
  const asset = findWorkspaceAsset(state, actor.workspace.id, body);
  const template = findWorkspaceTemplate(state, actor.workspace.id, body);
  const objectType = body.objectType || (asset ? 'asset' : template ? 'template' : 'content');
  const objectId = body.objectId || asset?.id || template?.id || '';
  const event = {
    id: createId('contentuse'),
    workspaceId: actor.workspace.id,
    objectType,
    objectId,
    objectName: body.objectName || asset?.name || template?.name || 'Content object',
    campaignId: body.campaignId || '',
    channel: body.channel || 'email',
    placement: body.placement || 'campaign_builder',
    metricName: body.metricName || 'content_selected',
    metricValue: Number(body.metricValue || 1),
    metadata: parseJsonObject(body.metadata),
    recordedAt: nowIso()
  };
  state.db.contentUsageTelemetryEvents.unshift(event);
  state.db.contentUsageTelemetryEvents = state.db.contentUsageTelemetryEvents.slice(0, 1000);
  if (asset) asset.usageCount = Number(asset.usageCount || 0) + event.metricValue;
  if (template && template.workspaceId === actor.workspace.id) template.usageCount = Number(template.usageCount || 0) + event.metricValue;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-usage-telemetry', detail: `${event.metricName} for ${event.objectName}` });
  return event;
}

export function recordContentGovernanceEvent(state, actor, body = {}) {
  ensureContentRuntimeCollections(state.db);
  const brandKit = ensureBrandKit(state, actor);
  const event = {
    id: createId('contentgov'),
    workspaceId: actor.workspace.id,
    brandKitId: brandKit.id,
    policy: body.policy || 'brand_kit_required',
    scope: body.scope || 'content_studio',
    result: body.result || 'passed',
    violations: splitList(body.violations),
    remediation: body.remediation || '',
    reviewerId: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.contentGovernanceEvents.unshift(event);
  state.db.contentGovernanceEvents = state.db.contentGovernanceEvents.slice(0, 1000);
  brandKit.lastGovernanceEventId = event.id;
  brandKit.governanceStatus = event.result;
  brandKit.updatedAt = event.recordedAt;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-governance-check', detail: `${event.policy} ${event.result}` });
  return event;
}

export function buildContentStudioRuntimeSnapshot(state, workspaceId) {
  ensureContentRuntimeCollections(state.db);
  const assets = state.db.assets.filter((entry) => entry.workspaceId === workspaceId);
  const workspaceTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId);
  const collections = state.db.templateCollections.filter((entry) => entry.workspaceId === workspaceId);
  const brandKits = state.db.brandKits.filter((entry) => entry.workspaceId === workspaceId);
  const lifecycle = state.db.contentAssetLifecycleEvents.filter((entry) => entry.workspaceId === workspaceId);
  const reviews = state.db.contentTemplateReviewEvents.filter((entry) => entry.workspaceId === workspaceId);
  const usage = state.db.contentUsageTelemetryEvents.filter((entry) => entry.workspaceId === workspaceId);
  const governance = state.db.contentGovernanceEvents.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...CONTENT_STUDIO_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    assetCount: assets.length,
    savedTemplateCount: workspaceTemplates.length,
    systemTemplateCount: (state.db.templates || []).length,
    collectionCount: collections.length,
    brandKitCount: brandKits.length,
    assetLifecycleEventCount: lifecycle.length,
    templateReviewEventCount: reviews.length,
    usageTelemetryEventCount: usage.length,
    governanceEventCount: governance.length,
    approvedAssetCount: assets.filter((entry) => entry.lifecycleStatus === 'approved').length,
    approvedTemplateCount: workspaceTemplates.filter((entry) => entry.reviewStatus === 'approved').length,
    brandGovernanceStatus: brandKits[0]?.governanceStatus || 'not_reviewed',
    templateReviewQueue: workspaceTemplates.map((template) => ({ id: template.id, name: template.name, category: template.category, reviewStatus: template.reviewStatus || 'not_reviewed', usageCount: Number(template.usageCount || 0) })),
    assetLifecycle: assets.map((asset) => ({ id: asset.id, name: asset.name, folder: asset.folder, lifecycleStatus: asset.lifecycleStatus || 'uploaded', usageCount: Number(asset.usageCount || 0) })),
    recentLifecycleEvents: lifecycle.slice(0, 10),
    recentTemplateReviews: reviews.slice(0, 10),
    recentUsageEvents: usage.slice(0, 10),
    recentGovernanceEvents: governance.slice(0, 10)
  };
}

export function persistContentStudioRuntimeSnapshot(state, actor, reason = 'manual_content_runtime_snapshot') {
  ensureContentRuntimeCollections(state.db);
  const snapshot = buildContentStudioRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('contentrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.contentRuntimeSnapshots.unshift(entry);
  state.db.contentRuntimeSnapshots = state.db.contentRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-runtime-snapshot', detail: 'Captured content studio runtime snapshot' });
  return entry;
}
