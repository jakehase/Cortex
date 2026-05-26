import { page } from '../view.mjs';
import { escapeHtml, text } from '../utils.mjs';

export function registerContentLibraryRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/content/library', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    const snippets = state.db.assetSnippets.filter((entry) => entry.workspaceId === actor.workspace.id);
    const templates = state.db.contentTemplates.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Content library', actor, `<div class="grid"><div class="card"><h3>Library inventory</h3><p>Assets: ${assets.length}</p><p>Snippets: ${snippets.length}</p><p>Workspace templates: ${templates.length}</p><p><a href="/content">Open studio</a> · <a href="/content/depth">Search depth</a></p></div><div class="card"><h3>Channels</h3><p>${[...new Set(snippets.map((entry) => entry.channel || 'email'))].map(escapeHtml).join(', ') || 'Email'}</p></div></div><div class="card"><table><tr><th>Name</th><th>Kind</th><th>Detail</th></tr>${assets.map((asset) => `<tr><td>${escapeHtml(asset.name)}</td><td>asset</td><td>${escapeHtml(asset.folder || 'Root')}</td></tr>`).join('')}${snippets.map((snippet) => `<tr><td>${escapeHtml(snippet.name)}</td><td>snippet</td><td>${escapeHtml((snippet.tags || []).join(', '))}</td></tr>`).join('')}${templates.map((template) => `<tr><td>${escapeHtml(template.name)}</td><td>template</td><td>${escapeHtml(template.category || 'General')}</td></tr>`).join('') || '<tr><td colspan="3">Add assets or snippets to populate the library.</td></tr>'}</table></div>`));
  });
}
