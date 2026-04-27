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
    const preset = block.stylePreset || 'default';
    const align = block.alignment || 'left';
    const background = block.backgroundColor || (preset === 'hero' ? '#fff4cc' : preset === 'promo' ? '#eef4ff' : preset === 'footer' ? '#10254d' : '#ffffff');
    const textColor = block.textColor || (preset === 'footer' ? '#ffffff' : '#18212f');
    const padding = block.padding || (preset === 'hero' ? '28px' : '20px');
    const eyebrow = block.eyebrow ? `<div style="font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:.75;margin-bottom:8px;">${block.eyebrow}</div>` : '';
    const title = block.title ? `<h3 style="margin:0 0 10px;">${block.title}</h3>` : '';
    const sectionLabel = block.sectionName ? `<div style="margin-bottom:8px;font-size:12px;font-weight:700;opacity:.7;">${block.sectionName}</div>` : '';
    const body = block.body ? `<p style="margin:0 0 12px;white-space:pre-wrap;">${block.body}</p>` : '';
    const wrapperStyle = `background:${background};color:${textColor};padding:${padding};border-radius:${preset === 'hero' ? '20px' : '16px'};text-align:${align};margin-bottom:12px;`;
    if (block.type === 'button') {
      const buttonStyle = block.buttonStyle || 'primary';
      const buttonCss = buttonStyle === 'secondary'
        ? 'background:#ffffff;color:#0b3b8c;border:1px solid #b8c7df;'
        : buttonStyle === 'ghost'
          ? 'background:transparent;color:inherit;border:1px solid currentColor;'
          : 'background:#0b3b8c;color:#ffffff;border:none;';
      return `<section style="${wrapperStyle}">${sectionLabel}${eyebrow}${title}${body}<a href="${block.buttonUrl || '#'}" style="display:inline-flex;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:800;${buttonCss}">${block.buttonLabel || 'CTA'}</a></section>`;
    }
    if (block.type === 'image') return `<section style="${wrapperStyle}">${sectionLabel}${eyebrow}${title}<p style="font-size:13px;opacity:.8;margin:0 0 8px;">${assetName}</p>${block.imageAlt ? `<p style="font-size:12px;opacity:.72;margin:0 0 8px;">Alt: ${block.imageAlt}</p>` : ''}${body}</section>`;
    return `<section style="${wrapperStyle}">${sectionLabel}${eyebrow}${title}${body}</section>`;
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

export function campaignAutomationRuntimeSummary(state, campaign) {
  const linkedAutomations = state.db.automations.filter((entry) => entry.workspaceId === campaign.workspaceId && (entry.sourceCampaignId === campaign.id || entry.trigger === 'campaign_sent'));
  const relatedRuns = state.db.automationRuns.filter((run) => run.campaignId === campaign.id);
  return {
    linkedAutomations: linkedAutomations.length,
    liveAutomations: linkedAutomations.filter((entry) => entry.status === 'live').length,
    relatedRuns: relatedRuns.length,
    lastTriggeredAt: relatedRuns[0]?.completedAt || relatedRuns[0]?.createdAt || null,
    recentRuns: relatedRuns.slice(0, 3).map((run) => ({
      id: run.id,
      automationId: run.automationId,
      trigger: run.trigger || 'campaign_sent',
      status: run.status || 'completed',
      completedAt: run.completedAt || run.createdAt || ''
    }))
  };
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

export function campaignLaunchChecklist(state, campaign, workspace) {
  const blockers = preflightCampaign(state, campaign, workspace);
  const runtime = campaignAutomationRuntimeSummary(state, campaign);
  const recipients = recipientCount(state, campaign);
  return {
    campaignId: campaign.id,
    nextStep: campaignNextStep(campaign),
    blockers,
    ready: blockers.length === 0,
    recipients,
    automationsLinked: runtime.linkedAutomations,
    liveAutomations: runtime.liveAutomations,
    recentAutomationRuns: runtime.recentRuns,
    setup: {
      setupComplete: Boolean(campaign.setupComplete),
      recipientsComplete: Boolean(campaign.recipientsComplete),
      hasTemplate: Boolean(campaign.templateId),
      hasSubject: Boolean(campaign.subject),
      hasPreheader: Boolean(campaign.preheader),
      blockCount: (campaign.blocks || []).length
    }
  };
}

export function campaignPerformanceSnapshot(state, campaign) {
  const report = campaign.report || {};
  const recipients = Math.max(1, recipientCount(state, campaign));
  const opens = Number(report.opens || 0);
  const clicks = Number(report.clicks || 0);
  const bounces = Number(report.bounces || 0);
  const unsubscribes = Number(report.unsubscribes || 0);
  return {
    campaignId: campaign.id,
    recipients,
    openRate: Number((opens / recipients).toFixed(3)),
    clickRate: Number((clicks / recipients).toFixed(3)),
    bounceRate: Number((bounces / recipients).toFixed(3)),
    unsubscribeRate: Number((unsubscribes / recipients).toFixed(3)),
    automationRuns: Number(report.funnel?.attributedAutomationRuns || 0),
    formSubmissions: Number(report.funnel?.formSubmissions || 0),
    landingSubmissions: Number(report.funnel?.landingSubmissions || 0),
    history: Array.isArray(report.history) ? report.history.slice(0, 5) : []
  };
}

export function buildCampaignFollowupPlan(state, campaign) {
  const snapshot = campaignPerformanceSnapshot(state, campaign);
  const plan = [];
  if (snapshot.openRate < 0.3) {
    plan.push({ action: 'refresh_subject_and_preheader', reason: 'Open rate is below the healthy threshold for this audience.' });
  }
  if (snapshot.clickRate < 0.12) {
    plan.push({ action: 'tighten_cta_blocks', reason: 'Click rate suggests the body or CTA hierarchy is underperforming.' });
  }
  if ((campaign.blocks || []).length < 3) {
    plan.push({ action: 'expand_editor_depth', reason: 'Campaign is still too shallow for richer narrative progression.' });
  }
  if (snapshot.automationRuns === 0) {
    plan.push({ action: 'attach_followup_journey', reason: 'No triggered journey is extending campaign value after send.' });
  }
  return {
    campaignId: campaign.id,
    generatedAt: nowIso(),
    plan,
    summary: snapshot
  };
}
