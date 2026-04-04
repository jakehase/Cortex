import { saveDb } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, enqueueJob, recordAudit } from './domain-core.mjs';
import { contactsForAudience, matchSegment } from './domain-audience.mjs';
import { campaignGrowthFunnel, triggerAutomationsForEvent } from './domain-growth.mjs';

export function recipientCount(state, campaign) {
  if (!campaign.audienceId) return 0;
  const contacts = contactsForAudience(state, campaign.audienceId).filter((contact) => contact.status === 'subscribed');
  if (!campaign.segmentId) return contacts.length;
  const segment = state.db.segments.find((entry) => entry.id === campaign.segmentId);
  return contacts.filter((contact) => matchSegment(contact, segment)).length;
}

export function campaignNextStep(campaign) {
  if (!campaign.setupComplete) return 'setup';
  if (!campaign.recipientsComplete) return 'recipients';
  if (!campaign.templateId) return 'templates';
  if (!campaign.blocks?.length) return 'editor';
  return 'review';
}

export function renderBlocksHtml(blocks = [], state, workspaceId) {
  return blocks.map((block) => {
    if (block.type === 'divider') return '<hr>';
    const assetName = state.db.assets.find((entry) => entry.id === block.assetId && entry.workspaceId === workspaceId)?.name || 'No asset selected';
    if (block.type === 'button') return `<section><h3>${block.title || ''}</h3><a href="${block.buttonUrl || '#'}">${block.buttonLabel || 'CTA'}</a></section>`;
    if (block.type === 'image') return `<section><h3>${block.title || ''}</h3><p>${assetName}</p><p>${block.body || ''}</p></section>`;
    return `<section><h3>${block.title || ''}</h3><p>${block.body || ''}</p></section>`;
  }).join('');
}

export function campaignHtml(campaign, state) {
  return `<!doctype html><html><body>${renderBlocksHtml(campaign.blocks || [], state, campaign.workspaceId)}</body></html>`;
}

export function approvalStatusForCampaign(state, campaign) {
  const requests = state.db.approvalRequests.filter((entry) => entry.targetType === 'campaign' && entry.targetId === campaign.id);
  const latest = requests[0] || null;
  return {
    latest,
    pending: requests.some((entry) => entry.status === 'pending'),
    changesRequested: requests.some((entry) => entry.status === 'changes_requested'),
    approved: latest?.status === 'approved'
  };
}

export function preflightCampaign(state, campaign, workspace) {
  const blockers = [];
  if (!campaign.name) blockers.push('Campaign name is required before review.');
  if (!campaign.subject) blockers.push('Subject line is required before review.');
  if (!campaign.preheader) blockers.push('Preheader text is required for inbox preview parity.');
  if (!campaign.audienceId) blockers.push('Choose an audience before review.');
  if (!campaign.templateId) blockers.push('Choose a template before review.');
  if (!campaign.blocks?.length) blockers.push('Add at least one content block in the email editor.');
  if (!workspace?.settings?.senderEmail) blockers.push('Workspace sender email is not configured.');
  if (!workspace?.settings?.address) blockers.push('Workspace physical mailing address is required.');
  if (recipientCount(state, campaign) < 1) blockers.push('No recipients match the selected audience and segment.');
  const approval = approvalStatusForCampaign(state, campaign);
  if (approval.pending) blockers.push('Campaign has a pending approval request. Resolve approval before sending.');
  if (approval.changesRequested) blockers.push('Campaign approval requested changes. Address governance feedback before sending.');
  return blockers;
}

export function campaignReviewState(state, campaign, workspace) {
  return {
    blockers: preflightCampaign(state, campaign, workspace),
    funnel: campaignGrowthFunnel(state, campaign.id),
    approval: approvalStatusForCampaign(state, campaign)
  };
}

export function createCampaign(state, actor, name) {
  const campaign = { id: createId('camp'), workspaceId: actor.workspace.id, name, subject: '', preheader: '', fromName: actor.workspace.settings.senderName || actor.user.name, replyTo: actor.workspace.settings.replyTo || actor.workspace.settings.senderEmail || '', audienceId: '', segmentId: '', templateId: '', blocks: [], status: 'draft', setupComplete: false, recipientsComplete: false, report: { opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, history: [], funnel: { landingPages: 0, landingViews: 0, landingSubmissions: 0, linkedForms: 0, formSubmissions: 0, attributedAutomationRuns: 0, attributedAutomationGoals: 0 } }, createdAt: nowIso(), updatedAt: nowIso() };
  state.db.campaigns.unshift(campaign);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-create', detail: `Created campaign ${campaign.name}` });
  return campaign;
}

export function queueTestSend(state, actor, campaign, testEmail) {
  enqueueJob(state, { type: 'send_test_campaign', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { campaignId: campaign.id, testEmail } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-test-send', detail: `Queued test send for ${campaign.name}` });
}

export function queueCampaignDelivery(state, actor, campaign, runAt = null) {
  campaign.status = runAt ? 'scheduled' : 'queued';
  enqueueJob(state, { type: 'deliver_campaign', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { campaignId: campaign.id }, runAt: runAt || undefined });
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: runAt ? 'campaign-schedule' : 'campaign-send', detail: `${runAt ? 'Scheduled' : 'Queued send for'} ${campaign.name}` });
}

export function markCampaignDelivered(state, campaign) {
  campaign.status = 'sent';
  campaign.sentAt = nowIso();
  campaign.updatedAt = nowIso();
  const recipients = contactsForAudience(state, campaign.audienceId).filter((contact) => contact.status === 'subscribed' && (!campaign.segmentId || matchSegment(contact, state.db.segments.find((entry) => entry.id === campaign.segmentId))));
  const recipientTotal = recipients.length;
  const automationRuns = [];
  for (const contact of recipients) automationRuns.push(...triggerAutomationsForEvent(state, { workspaceId: campaign.workspaceId, audienceId: campaign.audienceId, contact, eventType: 'campaign_sent', campaignId: campaign.id, meta: { campaignName: campaign.name } }));
  const funnel = campaignGrowthFunnel(state, campaign.id);
  campaign.report = {
    opens: Math.max(1, Math.floor(recipientTotal * 0.6)),
    clicks: Math.max(0, Math.floor(recipientTotal * 0.25)),
    bounces: 0,
    unsubscribes: 0,
    funnel: { ...funnel, attributedAutomationRuns: funnel.attributedAutomationRuns + automationRuns.length },
    history: [{ at: nowIso(), event: 'delivered', recipients: recipientTotal, automationRuns: automationRuns.length }]
  };
  saveDb(state.db);
  return createNotification(state, { workspaceId: campaign.workspaceId, type: 'campaign-send', payload: { campaignId: campaign.id, recipients: recipientTotal, subject: campaign.subject, automationRuns: automationRuns.length } });
}
