import { persistState } from '../storage.mjs';
import { page } from '../view.mjs';
import { escapeHtml, readBody, redirect, text } from '../utils.mjs';

export function registerTemplateRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/templates/library', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const workspaceTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === actor.workspace.id);
    const systemTemplates = state.db.templates || [];
    const campaigns = state.db.campaigns.filter((campaign) => campaign.workspaceId === actor.workspace.id);
    const categories = [...new Set([...systemTemplates, ...workspaceTemplates].map((template) => template.category || 'General'))];
    text(res, 200, page('Template library workspace', actor, `<div class="grid"><div class="card"><h3>Library coverage</h3><p>System templates: ${systemTemplates.length}</p><p>Workspace templates: ${workspaceTemplates.length}</p><p>Categories: ${categories.map(escapeHtml).join(', ')}</p><p><a href="/content">Create reusable content template</a></p></div><div class="card"><h3>Governance</h3><p>Template selection is connected to campaigns, content studio, approvals, and asset lineage.</p><p><a href="/content/depth">Open lineage search</a></p></div><div class="card"><h3>Campaign handoff</h3><form method="post" action="/templates/library/apply"><select name="campaignId">${campaigns.map((campaign) => `<option value="${campaign.id}">${escapeHtml(campaign.name || 'Untitled campaign')}</option>`).join('')}</select><select name="templateId">${[...workspaceTemplates, ...systemTemplates].map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('')}</select><button>Apply template to campaign editor</button></form><p>Template governance now writes directly into the campaign builder and preserves source metadata.</p></div></div><div class="card"><table><tr><th>Name</th><th>Category</th><th>Blocks</th><th>Source</th><th>Editor handoff</th></tr>${[...workspaceTemplates, ...systemTemplates].map((template) => `<tr><td>${escapeHtml(template.name)}</td><td>${escapeHtml(template.category || 'General')}</td><td>${(template.blocks || []).length}</td><td>${escapeHtml(template.source || (template.workspaceId ? 'workspace' : 'system'))}</td><td>${campaigns.length ? 'ready' : 'create a campaign first'}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/templates/library/apply', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const campaign = state.db.campaigns.find((entry) => entry.id === body.campaignId && entry.workspaceId === actor.workspace.id);
    const template = [...state.db.templates, ...state.db.contentTemplates].find((entry) => entry.id === body.templateId && (!entry.workspaceId || entry.workspaceId === actor.workspace.id));
    if (campaign && template) {
      campaign.templateId = template.id;
      campaign.templateAppliedAt = new Date().toISOString();
      campaign.templateSource = template.source || (template.workspaceId ? 'workspace' : 'system');
      campaign.blocks = (template.blocks || campaign.blocks || []).map((block, index) => ({ id: block.id || `template_block_${index}`, ...block }));
      campaign.updatedAt = new Date().toISOString();
      state.db.auditEvents.unshift({ id: `audit_${Date.now()}`, workspaceId: actor.workspace.id, userId: actor.user.id, action: 'template-campaign-apply', detail: `Applied ${template.name} to ${campaign.name}`, createdAt: new Date().toISOString() });
      persistState(state);
    }
    redirect(res, campaign ? `/campaigns/${campaign.id}/editor` : '/templates/library');
  });
}
