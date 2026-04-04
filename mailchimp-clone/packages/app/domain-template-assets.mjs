import { saveDb } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { recordAudit } from './domain-core.mjs';

export function ensureBrandKit(state, actor) {
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
  saveDb(state.db);
  return brandKit;
}

export function workspaceContentTemplates(state, workspaceId) {
  return [
    ...state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId),
    ...state.db.templates.map((entry) => ({ ...entry, workspaceId, source: 'system' }))
  ];
}

export function contentStudioSummary(state, workspaceId) {
  return {
    brandKits: state.db.brandKits.filter((entry) => entry.workspaceId === workspaceId).length,
    savedTemplates: state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).length,
    collections: state.db.templateCollections.filter((entry) => entry.workspaceId === workspaceId).length,
    assets: state.db.assets.filter((entry) => entry.workspaceId === workspaceId).length
  };
}

export function createTemplateCollection(state, actor, body) {
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'template-collection-create', detail: `Created collection ${collection.name}` });
  return collection;
}

export function saveContentTemplate(state, actor, body) {
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'content-template-save', detail: `Saved template ${template.name}` });
  return template;
}

export function updateBrandKit(state, actor, body) {
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'brand-kit-update', detail: `Updated brand kit ${brandKit.name}` });
  return brandKit;
}
