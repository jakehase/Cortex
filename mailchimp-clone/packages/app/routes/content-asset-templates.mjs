import { page } from '../view.mjs';
import { readBody, redirect, text } from '../utils.mjs';
import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';

export function registerContentAssetTemplateRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/content', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const brandKit = ensureBrandKit(state, actor);
    const summary = contentStudioSummary(state, actor.workspace.id);
    const templates = workspaceContentTemplates(state, actor.workspace.id);
    const collections = state.db.templateCollections.filter((entry) => entry.workspaceId === actor.workspace.id);
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Content studio templates & assets', actor, `<div class="grid"><div class="card"><h3>Brand kit</h3><form method="post" action="/content/brand-kit"><input name="name" value="${brandKit.name}"><input name="logoAssetName" value="${brandKit.logoAssetName || ''}" placeholder="logo.txt"><input name="primaryColor" value="${brandKit.primaryColor}"><input name="secondaryColor" value="${brandKit.secondaryColor}"><input name="headingFont" value="${brandKit.headingFont}"><input name="bodyFont" value="${brandKit.bodyFont}"><button>Save brand kit</button></form></div><div class="card"><h3>Studio summary</h3><ul><li>Brand kits: ${summary.brandKits}</li><li>Saved templates: ${summary.savedTemplates}</li><li>Collections: ${summary.collections}</li><li>Assets: ${summary.assets}</li></ul><p><a href="/content/depth">Open content depth tools</a></p></div></div><div class="grid"><div class="card"><h3>Save reusable template</h3><form method="post" action="/content/templates"><input name="name" placeholder="Executive update"><select name="baseTemplateId">${state.db.templates.map((template) => `<option value="${template.id}">${template.name}</option>`).join('')}</select><input name="category" placeholder="Internal"><textarea name="description" placeholder="When to use this template"></textarea><button>Save template</button></form></div><div class="card"><h3>Create asset collection</h3><form method="post" action="/content/collections"><input name="name" placeholder="Q2 launch kit"><input name="purpose" placeholder="Product launch assets"><input name="assetNames" placeholder="hero.txt, logo.png"><button>Create collection</button></form></div><div class="card"><h3>Depth workflows</h3><p><a href="/content/depth">Search assets + snippets + lineage</a></p><p>Version snapshots and content approval requests are now first-class.</p></div></div><div class="card"><h3>Saved content templates</h3><table><tr><th>Name</th><th>Category</th><th>Source</th><th>Blocks</th></tr>${templates.map((template) => `<tr><td>${template.name}</td><td>${template.category || '—'}</td><td>${template.source || 'system'}</td><td>${template.blocks?.length || 0}</td></tr>`).join('')}</table></div><div class="card"><h3>Asset collections</h3><table><tr><th>Name</th><th>Purpose</th><th>Assets</th></tr>${collections.map((collection) => `<tr><td>${collection.name}</td><td>${collection.purpose}</td><td>${collection.assetNames.join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="3">No collections yet.</td></tr>'}</table></div><div class="card"><h3>Connected assets</h3><table><tr><th>Name</th><th>Folder</th><th>Usage</th></tr>${assets.map((asset) => `<tr><td>${asset.name}</td><td>${asset.folder}</td><td>${asset.usageCount || 0}</td></tr>`).join('') || '<tr><td colspan="3">Upload assets from the content studio or campaign editor.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/content/brand-kit', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    updateBrandKit(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/templates', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    saveContentTemplate(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/collections', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    createTemplateCollection(state, actor, await readBody(req));
    redirect(res, '/content');
  });
}
