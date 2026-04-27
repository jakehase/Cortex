import { saveDb } from '../storage.mjs';
import { runJobs } from '../jobs.mjs';
import { page, blockEditorCard } from '../view.mjs';
import { hasFeature, recordAudit } from '../domain-core.mjs';
import { buildCampaignEditorLayoutPreset, buildCampaignEditorNarrativeOutline, campaignNextStep, campaignReviewState, createCampaign, queueCampaignDelivery, queueTestSend, recipientCount, renderBlocksHtml, summarizeCampaignEditorReadiness } from '../domain-campaigns.mjs';
import { createId, nowIso, readBody, redirect, text } from '../utils.mjs';

const DEFAULT_EDITOR_SETTINGS = {
  brandTone: 'confident',
  audienceAngle: 'product value',
  layoutDensity: 'balanced',
  heroStyle: 'feature-led'
};

function cloneEditorBlocks(blocks = []) {
  return JSON.parse(JSON.stringify(blocks || []));
}

function normalizeBlock(block = {}) {
  const type = block.type || 'text';
  if (type === 'divider') return { type: 'divider' };
  return {
    type,
    title: block.title || '',
    body: block.body || '',
    buttonLabel: block.buttonLabel || '',
    buttonUrl: block.buttonUrl || '',
    buttonStyle: block.buttonStyle || 'primary',
    assetId: block.assetId || '',
    stylePreset: block.stylePreset || (type === 'hero' ? 'hero' : 'default'),
    alignment: block.alignment || block.textAlign || 'left',
    backgroundColor: block.backgroundColor || '',
    textColor: block.textColor || '',
    padding: block.padding || (type === 'hero' ? '28px' : '20px'),
    eyebrow: block.eyebrow || '',
    sectionName: block.sectionName || '',
    imageAlt: block.imageAlt || ''
  };
}

function ensureEditorState(campaign) {
  campaign.blocks = (campaign.blocks || []).map((block) => normalizeBlock(block));
  campaign.editorSettings = { ...DEFAULT_EDITOR_SETTINGS, ...(campaign.editorSettings || {}) };
  campaign.editorSnapshots ||= [];
}

function recordEditorSnapshot(campaign, label) {
  ensureEditorState(campaign);
  campaign.editorSnapshots.unshift({
    id: createId('snapshot'),
    label,
    createdAt: nowIso(),
    editorSettings: { ...campaign.editorSettings },
    blocks: cloneEditorBlocks(campaign.blocks)
  });
  campaign.editorSnapshots = campaign.editorSnapshots.slice(0, 12);
}

function applyBlockPreset(campaign, preset) {
  const presets = {
    hero: {
      type: 'hero',
      stylePreset: 'hero',
      sectionName: 'Hero',
      eyebrow: 'NEW',
      title: 'Launch something people notice',
      body: 'Lead with the biggest message, then reinforce it with a clear next step.',
      alignment: 'left',
      backgroundColor: '#fff4cc',
      padding: '28px'
    },
    feature: {
      type: 'text',
      stylePreset: 'feature',
      sectionName: 'Feature highlight',
      eyebrow: 'FEATURE',
      title: 'What changed',
      body: 'Call out a capability, why it matters, and the outcome for the audience.',
      alignment: 'left',
      backgroundColor: '#ffffff',
      padding: '20px'
    },
    promo: {
      type: 'button',
      stylePreset: 'promo',
      sectionName: 'Offer section',
      eyebrow: 'LIMITED DROP',
      title: 'Launch day offer',
      body: 'Pair urgency, proof, and one clear call to action.',
      buttonLabel: 'Shop now',
      buttonUrl: 'https://example.test/offer',
      buttonStyle: 'primary',
      alignment: 'center',
      backgroundColor: '#eef4ff',
      textColor: '#18212f',
      padding: '24px'
    },
    footer: {
      type: 'text',
      stylePreset: 'footer',
      sectionName: 'Footer',
      title: 'Keep in touch',
      body: 'Wrap with support details, social prompts, and preference links.',
      alignment: 'left',
      backgroundColor: '#10254d',
      textColor: '#ffffff',
      padding: '20px'
    }
  };
  campaign.blocks.push(normalizeBlock(presets[preset] || { type: 'text', title: 'New block' }));
}

function renderEditorReadiness(readiness) {
  return `<div class="card"><h3>Editor readiness</h3><p><strong>Score:</strong> ${readiness.score}</p><p><strong>Blocks:</strong> ${readiness.blockCount} · <strong>Sections:</strong> ${readiness.sectionCount}</p><p>${readiness.strengths.length ? readiness.strengths.join(' · ') : 'No strengths recorded yet.'}</p>${readiness.warnings.length ? `<div class="warn"><ul>${readiness.warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul></div>` : '<div class="ok">Structure looks balanced enough for review.</div>'}</div>`;
}

function renderEditorOutline(outline = []) {
  return `<div class="card"><h3>Narrative outline</h3>${outline.length ? `<ol>${outline.map((entry) => `<li><strong>${entry.sectionName}</strong> · ${entry.intent}${entry.title ? `<br><span class="muted">${entry.title}</span>` : ''}${entry.ctaLabel ? `<br><span class="pill">${entry.ctaLabel}</span>` : ''}</li>`).join('')}</ol>` : '<p class="muted">Add blocks to build an outline.</p>'}</div>`;
}

export function registerCampaignRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/campaigns', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Campaign index', actor, `<div class="card"><p><a href="/campaigns/new">Create campaign</a></p><table><tr><th>Name</th><th>Status</th><th>Recipients</th><th>Template</th><th>Resume</th><th>Actions</th></tr>${campaigns.map((campaign) => `<tr><td>${campaign.name || 'Untitled'}</td><td>${campaign.status}</td><td>${recipientCount(state, campaign)}</td><td>${state.db.templates.find((entry) => entry.id === campaign.templateId)?.name || '—'}</td><td><a href="/campaigns/${campaign.id}/resume">Resume at ${campaignNextStep(campaign)}</a></td><td><a href="/campaigns/${campaign.id}/setup">Setup</a> · <a href="/campaigns/${campaign.id}/recipients">Recipients</a> · <a href="/campaigns/${campaign.id}/templates">Templates</a> · <a href="/campaigns/${campaign.id}/editor">Editor</a> · <a href="/campaigns/${campaign.id}/review">Review</a> · <a href="/reports/campaigns/${campaign.id}">Report</a></td></tr>`).join('')}</table></div>`));
  });

  router.register('GET', '/campaigns/new', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    text(res, 200, page('Campaign creation wizard', actor, '<div class="steps"><span class="step active">1. Setup</span><span class="step">2. Recipients</span><span class="step">3. Template</span><span class="step">4. Design</span><span class="step">5. Review</span></div><div class="card"><form method="post" action="/campaigns"><input name="name" placeholder="Spring launch" required><button>Create draft</button></form></div>'));
  });

  router.register('POST', '/campaigns', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = createCampaign(state, actor, (await readBody(req)).name);
    redirect(res, `/campaigns/${campaign.id}/setup`);
  });

  router.register('GET', '/campaigns/:id/resume', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    redirect(res, `/campaigns/${campaign.id}/${campaignNextStep(campaign)}`);
  });

  for (const step of ['setup', 'recipients', 'templates']) {
    router.register('GET', `/campaigns/:id/${step}`, async ({ state, req, params, res }) => {
      const actor = requireAuth(state, req, res); if (!actor) return;
      const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
      if (step === 'setup') return text(res, 200, page(`Campaign setup: ${campaign.name}`, actor, `<div class="steps"><span class="step active">1. Setup</span><span class="step">2. Recipients</span><span class="step">3. Template</span><span class="step">4. Design</span><span class="step">5. Review</span></div><div class="grid"><div class="card"><form method="post" action="/campaigns/${campaign.id}/setup"><input name="name" value="${campaign.name}"><input name="subject" value="${campaign.subject}"><input name="preheader" value="${campaign.preheader}"><input name="fromName" value="${campaign.fromName}"><input name="replyTo" value="${campaign.replyTo}"><button>Save setup</button></form></div><div class="card"><h3>AI assist</h3><p><a href="/campaigns/${campaign.id}/ai">Generate subject, preheader, and block suggestions</a></p><p>Accepted suggestions: ${(campaign.aiAssistance?.accepted || []).length}</p></div><div class="card"><h3>Predictive optimization</h3><p><a href="/campaigns/${campaign.id}/optimization">Apply send-time and targeting recommendations</a></p><p>${campaign.optimization?.predictiveSegment || 'No predictive settings applied yet.'}</p></div></div>`));
      if (step === 'recipients') {
        const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
        const segments = state.db.segments.filter((entry) => entry.workspaceId === actor.workspace.id && entry.audienceId === (campaign.audienceId || audiences[0]?.id));
        return text(res, 200, page(`Campaign recipients: ${campaign.name}`, actor, `<div class="steps"><span class="step">1. Setup</span><span class="step active">2. Recipients</span><span class="step">3. Template</span><span class="step">4. Design</span><span class="step">5. Review</span></div><div class="card"><form method="post" action="/campaigns/${campaign.id}/recipients"><select name="audienceId">${audiences.map((audience) => `<option value="${audience.id}" ${audience.id === campaign.audienceId ? 'selected' : ''}>${audience.name}</option>`).join('')}</select><select name="segmentId"><option value="">All subscribed contacts</option>${segments.map((segment) => `<option value="${segment.id}" ${segment.id === campaign.segmentId ? 'selected' : ''}>${segment.name} (${segment.lastMatchCount})</option>`).join('')}</select><button>Save recipients</button></form><p>Current recipient estimate: ${recipientCount(state, campaign)}</p></div>`));
      }
      return text(res, 200, page(`Template library: ${campaign.name}`, actor, `<div class="steps"><span class="step">1. Setup</span><span class="step">2. Recipients</span><span class="step active">3. Template</span><span class="step">4. Design</span><span class="step">5. Review</span></div><div class="grid">${state.db.templates.map((template) => `<div class="card"><span class="pill">${template.category}</span><h3>${template.name}</h3><p>${template.description}</p><p>${template.blocks.length} starter blocks</p><form method="post" action="/campaigns/${campaign.id}/template"><input type="hidden" name="templateId" value="${template.id}"><button>Use template</button></form></div>`).join('')}</div>`));
    });
  }

  router.register('POST', '/campaigns/:id/setup', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    Object.assign(campaign, { ...(await readBody(req)), setupComplete: true, updatedAt: nowIso() });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-setup', detail: `Updated campaign setup ${campaign.name}` });
    redirect(res, `/campaigns/${campaign.id}/recipients`);
  });

  router.register('POST', '/campaigns/:id/recipients', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const body = await readBody(req);
    Object.assign(campaign, { audienceId: body.audienceId, segmentId: body.segmentId || '', recipientsComplete: Boolean(body.audienceId), updatedAt: nowIso() });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-recipients', detail: `Updated recipients for ${campaign.name}` });
    redirect(res, `/campaigns/${campaign.id}/templates`);
  });

  router.register('POST', '/campaigns/:id/template', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const body = await readBody(req);
    const template = state.db.templates.find((entry) => entry.id === body.templateId);
    campaign.templateId = template.id;
    if (!campaign.blocks.length) campaign.blocks = template.blocks.map((block) => normalizeBlock(block));
    ensureEditorState(campaign);
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-template-select', detail: `Selected template ${template.name}` });
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('GET', '/campaigns/:id/editor', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    ensureEditorState(campaign);
    const readiness = summarizeCampaignEditorReadiness(campaign);
    const outline = buildCampaignEditorNarrativeOutline(campaign);
    text(res, 200, page(`Email editor: ${campaign.name}`, actor, `<div class="steps"><span class="step">1. Setup</span><span class="step">2. Recipients</span><span class="step">3. Template</span><span class="step active">4. Design</span><span class="step">5. Review</span></div><div class="grid"><div class="card"><h3>Add content block</h3><p class="muted">Builder palette</p><form method="post" action="/campaigns/${campaign.id}/editor/add-block"><select name="type"><option value="hero">hero</option><option value="text">text</option><option value="image">image</option><option value="button">button</option><option value="divider">divider</option></select><select name="preset"><option value="">Plain block</option><option value="hero">Hero preset</option><option value="feature">Feature preset</option><option value="promo">Promo preset</option><option value="footer">Footer preset</option></select><button>Add block</button></form><p class="muted">Use presets to scaffold a more Mailchimp-like email composition flow.</p></div><div class="card"><h3>Campaign design system</h3><form method="post" action="/campaigns/${campaign.id}/editor/settings"><select name="brandTone"><option value="confident" ${campaign.editorSettings.brandTone === 'confident' ? 'selected' : ''}>Confident</option><option value="playful" ${campaign.editorSettings.brandTone === 'playful' ? 'selected' : ''}>Playful</option><option value="editorial" ${campaign.editorSettings.brandTone === 'editorial' ? 'selected' : ''}>Editorial</option></select><select name="audienceAngle"><option value="product value" ${campaign.editorSettings.audienceAngle === 'product value' ? 'selected' : ''}>Product value</option><option value="education" ${campaign.editorSettings.audienceAngle === 'education' ? 'selected' : ''}>Education</option><option value="promotion" ${campaign.editorSettings.audienceAngle === 'promotion' ? 'selected' : ''}>Promotion</option></select><select name="layoutDensity"><option value="airy" ${campaign.editorSettings.layoutDensity === 'airy' ? 'selected' : ''}>Airy</option><option value="balanced" ${campaign.editorSettings.layoutDensity === 'balanced' ? 'selected' : ''}>Balanced</option><option value="dense" ${campaign.editorSettings.layoutDensity === 'dense' ? 'selected' : ''}>Dense</option></select><select name="heroStyle"><option value="feature-led" ${campaign.editorSettings.heroStyle === 'feature-led' ? 'selected' : ''}>Feature-led</option><option value="offer-led" ${campaign.editorSettings.heroStyle === 'offer-led' ? 'selected' : ''}>Offer-led</option><option value="story-led" ${campaign.editorSettings.heroStyle === 'story-led' ? 'selected' : ''}>Story-led</option></select><button>Save editor settings</button></form></div><div class="card"><h3>Guided layouts</h3><form method="post" action="/campaigns/${campaign.id}/editor/apply-layout"><select name="preset"><option value="launch_story">Launch story</option><option value="product_digest">Product digest</option></select><select name="mode"><option value="append">Append</option><option value="replace">Replace draft</option></select><button>Apply layout</button></form><p class="muted">Generate a stronger promise → proof → CTA → footer flow using the current editor settings.</p></div><div class="card"><h3>Draft checkpoints</h3><form method="post" action="/campaigns/${campaign.id}/editor/save-snapshot"><input name="label" value="Manual checkpoint" placeholder="Checkpoint label"><button>Save checkpoint</button></form>${campaign.editorSnapshots.length ? `<ul>${campaign.editorSnapshots.map((snapshot) => `<li><strong>${snapshot.label}</strong><br><span class="muted">${snapshot.createdAt}</span><form method="post" action="/campaigns/${campaign.id}/editor/restore-snapshot/${snapshot.id}"><button>Restore</button></form></li>`).join('')}</ul>` : '<p class="muted">No checkpoints yet.</p>'}</div></div><div class="grid"><div class="card"><h3>Live preview</h3>${renderBlocksHtml(campaign.blocks || [], state, actor.workspace.id) || '<p>No blocks yet.</p>'}<div class="steps"><span class="pill">${campaign.editorSettings.brandTone}</span><span class="pill">${campaign.editorSettings.audienceAngle}</span><span class="pill">${campaign.editorSettings.layoutDensity}</span><span class="pill">${campaign.editorSettings.heroStyle}</span></div></div>${renderEditorReadiness(readiness)}${renderEditorOutline(outline)}<div class="card"><h3>AI + content depth</h3><p><a href="/campaigns/${campaign.id}/ai">Rewrite blocks with AI</a></p><p><a href="/content/depth">Open snippets, versions, and asset lineage</a></p><p><a href="/campaigns/${campaign.id}/review">Next: review & send</a></p></div></div><div class="grid">${(campaign.blocks || []).map((block, index) => blockEditorCard(block, index, campaign, assets)).join('')}</div>`));
  });

  router.register('POST', '/campaigns/:id/editor/apply-layout', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const body = await readBody(req);
    ensureEditorState(campaign);
    const generated = buildCampaignEditorLayoutPreset(campaign, { preset: body.preset || 'launch_story' }).map((block) => normalizeBlock(block));
    campaign.blocks = body.mode === 'replace' ? generated : [...campaign.blocks, ...generated];
    recordEditorSnapshot(campaign, `Applied ${body.preset || 'launch_story'} layout (${body.mode || 'append'})`);
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('POST', '/campaigns/:id/editor/settings', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const body = await readBody(req);
    ensureEditorState(campaign);
    campaign.editorSettings = { ...campaign.editorSettings, ...body };
    recordEditorSnapshot(campaign, 'Updated editor settings');
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('POST', '/campaigns/:id/editor/save-snapshot', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    recordEditorSnapshot(campaign, (await readBody(req)).label || 'Manual checkpoint');
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('POST', '/campaigns/:id/editor/restore-snapshot/:snapshotId', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    ensureEditorState(campaign);
    const snapshot = campaign.editorSnapshots.find((entry) => entry.id === params.snapshotId);
    if (snapshot) {
      campaign.blocks = cloneEditorBlocks(snapshot.blocks || []).map((block) => normalizeBlock(block));
      campaign.editorSettings = { ...campaign.editorSettings, ...(snapshot.editorSettings || {}) };
      recordEditorSnapshot(campaign, `Restored ${snapshot.label}`);
      saveDb(state.db);
    }
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('POST', '/campaigns/:id/editor/add-block', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const body = await readBody(req);
    ensureEditorState(campaign);
    if (body.type === 'divider') campaign.blocks.push({ type: 'divider' });
    else if (body.preset) applyBlockPreset(campaign, body.preset);
    else campaign.blocks.push(normalizeBlock({ type: body.type, title: body.type === 'button' ? 'Call to action' : '', body: '', buttonLabel: body.type === 'button' ? 'Learn more' : '', buttonUrl: body.type === 'button' ? 'https://example.test' : '', assetId: '', stylePreset: 'default', alignment: 'left', backgroundColor: '', textColor: '', padding: '20px', eyebrow: '', sectionName: '' }));
    recordEditorSnapshot(campaign, `Added ${body.preset || body.type} block`);
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('POST', '/campaigns/:id/editor/block/:index/update', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    ensureEditorState(campaign);
    const block = campaign.blocks[Number(params.index)];
    const body = await readBody(req);
    Object.assign(block, body, { alignment: body.alignment || body.textAlign || block.alignment || 'left' });
    recordEditorSnapshot(campaign, `Updated block ${Number(params.index) + 1}`);
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('POST', '/campaigns/:id/editor/block/:index/move', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    ensureEditorState(campaign);
    const index = Number(params.index);
    const target = body.direction === 'up' ? index - 1 : index + 1;
    if (campaign.blocks[target]) [campaign.blocks[index], campaign.blocks[target]] = [campaign.blocks[target], campaign.blocks[index]];
    recordEditorSnapshot(campaign, `Moved block ${index + 1} ${body.direction}`);
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  for (const action of ['duplicate', 'delete']) router.register('POST', `/campaigns/:id/editor/block/:index/${action}`, async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    ensureEditorState(campaign);
    const index = Number(params.index);
    if (action === 'duplicate') campaign.blocks.splice(index + 1, 0, normalizeBlock({ ...campaign.blocks[index] }));
    else campaign.blocks.splice(index, 1);
    recordEditorSnapshot(campaign, `${action === 'duplicate' ? 'Duplicated' : 'Deleted'} block ${index + 1}`);
    saveDb(state.db);
    redirect(res, `/campaigns/${campaign.id}/editor`);
  });

  router.register('GET', '/campaigns/:id/review', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    const reviewState = campaignReviewState(state, campaign, actor.workspace);
    const schedulingGate = hasFeature(actor.workspace, 'scheduledSend') ? '' : '<div class="warn">Scheduled send is visible but disabled on Starter. Upgrade to Growth to unlock scheduling.</div>';
    text(res, 200, page(`Send review: ${campaign.name}`, actor, `<div class="steps"><span class="step">1. Setup</span><span class="step">2. Recipients</span><span class="step">3. Template</span><span class="step">4. Design</span><span class="step active">5. Review</span></div><div class="grid"><div class="card"><h3>Checklist</h3>${reviewState.blockers.length ? `<div class="warn"><ul>${reviewState.blockers.map((blocker) => `<li>${blocker}</li>`).join('')}</ul></div>` : '<div class="ok">No blockers — campaign can send.</div>'}<p>Recipients: ${recipientCount(state, campaign)}</p><p>Approval status: ${campaign.approvalStatus || 'not_requested'}</p></div><div class="card"><h3>Linked growth funnel</h3><p>Landing pages: ${reviewState.funnel.landingPages}</p><p>Landing views: ${reviewState.funnel.landingViews}</p><p>Form submissions: ${reviewState.funnel.formSubmissions}</p><p>Attributed automation runs: ${reviewState.funnel.attributedAutomationRuns}</p></div><div class="card"><h3>Approval workflow</h3><p>Latest request: ${reviewState.approval.latest?.title || 'No approval request yet'}</p><p>Status: ${reviewState.approval.latest?.status || 'not_requested'}</p></div><div class="card"><h3>Test send</h3><form method="post" action="/campaigns/${campaign.id}/test-send"><input name="testEmail" type="email" required><button ${reviewState.blockers.length ? 'disabled' : ''}>Queue test send</button></form></div><div class="card"><h3>Schedule</h3>${schedulingGate}<form method="post" action="/campaigns/${campaign.id}/schedule"><input name="runAt" type="datetime-local" required><button ${(reviewState.blockers.length || !hasFeature(actor.workspace, 'scheduledSend')) ? 'disabled' : ''}>Schedule delivery</button></form></div><div class="card"><h3>Send now</h3><form method="post" action="/campaigns/${campaign.id}/send"><button ${reviewState.blockers.length ? 'disabled' : ''}>Queue immediate send</button></form></div><div class="card"><h3>Experimentation</h3><p><a href="/campaigns/${campaign.id}/experiments">Open A/B and dynamic content lab</a></p><p>Winner promoted: ${campaign.experimentWinnerId ? 'yes' : 'not yet'}</p></div><div class="card"><h3>Optimization</h3><p><a href="/campaigns/${campaign.id}/optimization">Review predictive settings</a></p><p>${campaign.optimization?.sendTimeWindow || 'No optimization applied yet.'}</p><p>${campaign.optimization?.predictiveSegment || ''}</p></div><div class="card"><h3>Governance</h3><p><a href="/approvals">Request campaign approval</a></p><p><a href="/deliverability">Open deliverability center</a></p></div></div>`));
  });

  router.register('POST', '/campaigns/:id/test-send', async ({ state, req, params, res }) => { const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const reviewState = campaignReviewState(state, campaign, actor.workspace); if (reviewState.blockers.length) return redirect(res, `/campaigns/${campaign.id}/review`); queueTestSend(state, actor, campaign, (await readBody(req)).testEmail); redirect(res, '/jobs'); });
  router.register('POST', '/campaigns/:id/schedule', async ({ state, req, params, res }) => { const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const reviewState = campaignReviewState(state, campaign, actor.workspace); if (reviewState.blockers.length) return redirect(res, `/campaigns/${campaign.id}/review`); const parsed = new Date((await readBody(req)).runAt); const scheduled = Number.isNaN(parsed.getTime()) || parsed.getTime() - Date.now() < 1000 ? new Date(Date.now() + 500) : parsed; queueCampaignDelivery(state, actor, campaign, scheduled.toISOString()); redirect(res, '/jobs'); });
  router.register('POST', '/campaigns/:id/send', async ({ state, req, params, res }) => { const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const reviewState = campaignReviewState(state, campaign, actor.workspace); if (reviewState.blockers.length) return redirect(res, `/campaigns/${campaign.id}/review`); queueCampaignDelivery(state, actor, campaign); runJobs(state); redirect(res, '/jobs'); });
}
