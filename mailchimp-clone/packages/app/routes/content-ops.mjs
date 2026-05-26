import { page } from '../view.mjs';
import { escapeHtml, text } from '../utils.mjs';

export function registerContentOpsRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/content/ops', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const approvals = state.db.approvalRequests.filter((entry) => entry.workspaceId === actor.workspace.id && entry.targetType === 'content_template');
    const versions = state.db.contentVersions.filter((entry) => entry.workspaceId === actor.workspace.id);
    const contentEvents = state.db.events.filter((entry) => entry.workspaceId === actor.workspace.id && /content|asset|template|approval/i.test(`${entry.type} ${entry.message}`));
    text(res, 200, page('Content operations', actor, `<div class="grid"><div class="card"><h3>Operations health</h3><p>Approvals: ${approvals.length}</p><p>Version snapshots: ${versions.length}</p><p>Recent content events: ${contentEvents.length}</p><p><a href="/content/library">Open content library</a></p></div><div class="card"><h3>Workflow depth</h3><p>Versioning, approval requests, asset lineage, and content search are available from the authenticated product shell.</p><p><a href="/content/depth">Open depth workflows</a></p></div></div><div class="card"><table><tr><th>When</th><th>Type</th><th>Message</th></tr>${contentEvents.slice(0, 12).map((event) => `<tr><td>${escapeHtml(event.createdAt || '')}</td><td>${escapeHtml(event.type || '')}</td><td>${escapeHtml(event.message || '')}</td></tr>`).join('') || '<tr><td colspan="3">No content operations yet.</td></tr>'}</table></div>`));
  });
}
