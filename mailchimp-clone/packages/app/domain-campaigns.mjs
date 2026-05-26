import { persistState } from './storage.mjs';
import { campaignReportFromEvents, recordAnalyticsEvent } from './analytics-events.mjs';
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

export const GUIDED_CAMPAIGN_LAYOUTS = [
  {
    id: 'launch_story',
    label: 'Launch story',
    description: 'A Mailchimp-style announcement arc with hero, supporting proof, primary CTA, and footer reassurance.',
    blocks: [
      { type: 'hero', sectionName: 'Launch hero', eyebrow: 'NEW', title: 'Launch hero', body: 'Introduce the customer problem, the new offer, and the reason to care.', stylePreset: 'hero', alignment: 'left', backgroundColor: '#fff4cc', padding: '30px' },
      { type: 'text', sectionName: 'Value proof', eyebrow: 'WHY IT MATTERS', title: 'What changed', body: 'Summarize the benefits in short, scannable copy with clear customer outcomes.', stylePreset: 'feature', alignment: 'left' },
      { type: 'button', sectionName: 'Primary CTA', eyebrow: 'NEXT STEP', title: 'Review the launch', body: 'Send readers to the highest-intent destination.', buttonLabel: 'Review the launch', buttonUrl: 'https://example.test/launch', stylePreset: 'promo', buttonStyle: 'primary', alignment: 'center' },
      { type: 'text', sectionName: 'Support footer', eyebrow: 'HELP', title: 'Support footer', body: 'Add trust, reply guidance, and unsubscribe-safe footer context.', stylePreset: 'footer', alignment: 'left' }
    ]
  },
  {
    id: 'product_education',
    label: 'Product education',
    description: 'A nurture layout for teaching a feature before asking for a click.',
    blocks: [
      { type: 'hero', sectionName: 'Education hero', eyebrow: 'GUIDE', title: 'Learn the workflow', body: 'Frame the lesson and outcome.', stylePreset: 'hero' },
      { type: 'text', sectionName: 'How it works', title: 'Three practical steps', body: 'Explain the steps with concise examples.', stylePreset: 'feature' },
      { type: 'button', sectionName: 'Learning CTA', title: 'Keep learning', buttonLabel: 'Open guide', buttonUrl: 'https://example.test/guide', stylePreset: 'promo' }
    ]
  }
];

export function campaignEditorReadiness(campaign, state, workspace) {
  const blockers = [];
  if (!campaign.subject) blockers.push('subject missing');
  if (!campaign.preheader) blockers.push('preheader missing');
  if (!campaign.templateId) blockers.push('template not selected');
  if (!campaign.blocks?.length) blockers.push('content blocks missing');
  if (!workspace?.settings?.senderEmail) blockers.push('sender identity missing');
  const assetCount = state.db.assets.filter((asset) => asset.workspaceId === campaign.workspaceId).length;
  const snapshots = campaign.editorSnapshots?.length || 0;
  const score = Math.max(0, 100 - blockers.length * 18 + Math.min(10, snapshots * 2) + Math.min(10, assetCount * 2));
  return {
    score: Math.min(100, score),
    blockers,
    assetCount,
    snapshots,
    layout: campaign.editorLayout?.label || 'Custom layout',
    readyForReview: blockers.length === 0
  };
}

export function campaignNarrativeOutline(campaign) {
  const blocks = campaign.blocks || [];
  return blocks.map((block, index) => ({
    step: index + 1,
    section: block.sectionName || block.title || block.type,
    role: block.type === 'hero' ? 'hook' : block.type === 'button' ? 'conversion' : block.stylePreset === 'footer' ? 'trust' : 'supporting proof',
    hasCta: Boolean(block.buttonLabel || block.buttonUrl)
  }));
}

export function applyGuidedCampaignLayout(campaign, preset = 'launch_story', mode = 'replace') {
  const layout = GUIDED_CAMPAIGN_LAYOUTS.find((entry) => entry.id === preset) || GUIDED_CAMPAIGN_LAYOUTS[0];
  const blocks = layout.blocks.map((block) => ({ id: createId('block'), ...block }));
  campaign.blocks = mode === 'append' ? [...(campaign.blocks || []), ...blocks] : blocks;
  campaign.editorLayout = { id: layout.id, label: layout.label, appliedAt: nowIso(), mode };
  campaign.updatedAt = nowIso();
  return layout;
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

export function campaignReportDetailSummary(state, campaign) {
  const recipients = campaign.report?.history?.[0]?.recipients || recipientCount(state, campaign) || 0;
  const opens = campaign.report?.opens || 0;
  const clicks = campaign.report?.clicks || 0;
  const history = campaign.report?.history || [];
  const automation = campaignAutomationRuntimeSummary(state, campaign);
  return {
    recipients,
    opens,
    clicks,
    openRate: recipients > 0 ? Number(((opens / recipients) * 100).toFixed(2)) : 0,
    clickRate: recipients > 0 ? Number(((clicks / recipients) * 100).toFixed(2)) : 0,
    lastEventAt: history[0]?.sentAt || history[0]?.at || campaign.sentAt || campaign.updatedAt || null,
    automationRuns: automation.relatedRuns,
    funnel: campaignGrowthFunnel(state, campaign.id)
  };
}

export function campaignIndexSummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const deliveryJobs = state.db.jobs.filter((job) => job.workspaceId === workspaceId && job.type === 'deliver_campaign' && !['completed', 'failed', 'cancelled'].includes(job.status));
  const approvalRequests = state.db.approvalRequests.filter((entry) => entry.workspaceId === workspaceId && entry.targetType === 'campaign' && entry.status === 'pending');
  const scheduled = campaigns.filter((campaign) => campaign.status === 'scheduled');
  const nextScheduledAt = deliveryJobs.map((job) => job.runAt).filter(Boolean).sort()[0] || scheduled.map((campaign) => campaign.scheduledAt).filter(Boolean).sort()[0] || null;
  return {
    total: campaigns.length,
    draft: campaigns.filter((campaign) => campaign.status === 'draft').length,
    reviewReady: campaigns.filter((campaign) => campaignNextStep(campaign) === 'review').length,
    queued: campaigns.filter((campaign) => campaign.status === 'queued').length,
    scheduled: scheduled.length,
    sent: campaigns.filter((campaign) => campaign.status === 'sent').length,
    queuedDeliveries: deliveryJobs.length,
    approvalsPending: approvalRequests.length,
    nextScheduledAt
  };
}

export function emailBuilderParitySummary(state, workspaceId) {
  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId) : [];
  const draftCampaigns = campaigns.filter((entry) => ['draft', 'queued', 'scheduled'].includes(entry.status || 'draft'));
  const editorReady = draftCampaigns.filter((entry) => (entry.blocks || []).length > 0 && entry.templateId);
  const reusableTemplates = Array.isArray(state.db?.contentTemplates) ? state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).length : 0;
  return {
    campaigns: campaigns.length,
    draftCampaigns: draftCampaigns.length,
    editorReady: editorReady.length,
    reusableTemplates,
    nextStep: draftCampaigns[0] ? campaignNextStep(draftCampaigns[0]) : 'setup'
  };
}

export function campaignSendScheduleSummary(state, campaign, workspace) {
  const queuedDeliveries = state.db.jobs.filter((job) => job.workspaceId === campaign.workspaceId && job.type === 'deliver_campaign' && job.payload?.campaignId === campaign.id && !['completed', 'failed', 'cancelled'].includes(job.status));
  const approval = approvalStatusForCampaign(state, campaign);
  const senderReady = Boolean(workspace?.settings?.senderEmail && workspace?.settings?.address);
  const blockers = preflightCampaign(state, campaign, workspace);
  const nextRunAt = queuedDeliveries.map((job) => job.runAt).filter(Boolean).sort()[0] || campaign.scheduledAt || null;
  return {
    senderReady,
    approvalPending: approval.pending,
    blockers,
    queuedDeliveries: queuedDeliveries.length,
    nextRunAt,
    scheduleLabel: nextRunAt ? `Scheduled for ${nextRunAt}` : campaign.status === 'queued' ? 'Queued for immediate delivery' : 'No delivery scheduled'
  };
}

export function createCampaign(state, actor, name) {
  const campaign = { id: createId('camp'), workspaceId: actor.workspace.id, name, subject: '', preheader: '', fromName: actor.workspace.settings.senderName || actor.user.name, replyTo: actor.workspace.settings.replyTo || actor.workspace.settings.senderEmail || '', audienceId: '', segmentId: '', templateId: '', blocks: [], status: 'draft', setupComplete: false, recipientsComplete: false, report: { opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, history: [], funnel: { landingPages: 0, landingViews: 0, landingSubmissions: 0, linkedForms: 0, formSubmissions: 0, attributedAutomationRuns: 0, attributedAutomationGoals: 0 } }, createdAt: nowIso(), updatedAt: nowIso() };
  state.db.campaigns.unshift(campaign);
  persistState(state);
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
  persistState(state);
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
  persistState(state);
  return createNotification(state, { workspaceId: campaign.workspaceId, type: 'campaign-send', payload: { campaignId: campaign.id, recipients: recipientTotal, subject: campaign.subject, automationRuns: automationRuns.length } });
}


export function buildCampaignOpsCalendarWorkflowRuntimeEvidence(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspaceId || actor?.workspace?.id || 'default_workspace';
  const db = state.db || {};
  const activeJobs = Array.isArray(db.jobs) ? db.jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)) : [];
  const recentEvents = Array.isArray(db.auditEvents) ? db.auditEvents.slice(0, 5) : [];
  const providerSignals = Array.isArray(db.integrations) ? db.integrations.filter((entry) => entry.status !== 'disconnected') : [];
  const workflow = [
    { step: 'campaign_ops_calendar_workflow_request', status: input.requestReceived === false ? 'waiting' : 'received', route: input.route || 'packages/app/domain-campaigns.mjs' },
    { step: 'campaign_ops_calendar_workflow_state', status: db ? 'hydrated' : 'missing_state', jobs: activeJobs.length },
    { step: 'campaign_ops_calendar_workflow_response', status: input.responseReady === false ? 'pending' : 'ready', events: recentEvents.length }
  ];
  return {
    mailchimpSurface: 'campaign_ops_calendar_workflow',
    mailchimpLane: 'automation_journey_parity',
    productLabel: "Campaign ops and calendar workflow act more like product flows than fixtures parity",
    originatingShard: "focus.campaign_ops_calendar_workflow",
    workspaceId,
    generatedAt: input.now || new Date().toISOString(),
    workflow,
    routeResponse: { requestHandled: workflow[0].status === 'received', responseReady: workflow[2].status === 'ready', clientState: Boolean(input.clientState || input.browserEvent) },
    persistence: { hasStateDb: Boolean(state.db), pendingJobs: activeJobs.length, recoverable: activeJobs.some((job) => Number(job.attempts || 0) > 0) },
    providerSync: { activeProviderCount: providerSignals.length, sampleProviders: providerSignals.slice(0, 3).map((entry) => entry.id || entry.provider || entry.name) },
    auditTrail: recentEvents.map((entry) => ({ at: entry.at || entry.createdAt, type: entry.type || entry.event, status: entry.status || 'observed' }))
  };
}

export const reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "reporting_metrics_pipeline",
  "focusGroup": "reporting_analytics",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.reporting_metrics_pipeline::semantic-frontier-001#08-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildReportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/analytics-events.mjs","packages/app/domain-campaigns.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: reportingMetricsPipelineIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "template_library",
  "focusGroup": "template_library",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.template_library::semantic-frontier-001#04-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTemplateLibraryIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-template-assets.mjs","packages/app/routes/content-asset-templates.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "reporting_metrics_pipeline",
  "focusGroup": "reporting_analytics",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.reporting_metrics_pipeline::semantic-frontier-001#08-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildReportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/analytics-events.mjs","packages/app/domain-campaigns.mjs","packages/app/routes/api-admin.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: reportingMetricsPipelinePrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

export const templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "template_library",
  "focusGroup": "template_library",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.template_library::semantic-frontier-001#04-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTemplateLibraryPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-template-assets.mjs","packages/app/routes/content-asset-templates.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

export function campaignLaunchChecklist(state, campaign, workspace = {}) {
  const blockers = preflightCampaign(state, campaign, workspace);
  const recipients = recipientCount(state, campaign);
  const checks = [
    { id: 'setup', label: 'Setup complete', ok: Boolean(campaign.setupComplete || campaign.name) },
    { id: 'recipients', label: 'Recipients selected', ok: recipients > 0, detail: `${recipients} recipients` },
    { id: 'content', label: 'Subject, preheader, template, and blocks ready', ok: Boolean(campaign.subject && campaign.preheader && campaign.templateId && campaign.blocks?.length) },
    { id: 'sender', label: 'Sender identity and address configured', ok: Boolean(workspace?.settings?.senderEmail && workspace?.settings?.address) },
    { id: 'approval', label: 'No blocking approval request', ok: !approvalStatusForCampaign(state, campaign).pending }
  ];
  return { ready: blockers.length === 0 && checks.every((check) => check.ok), blockers, checks, recipients };
}

export function campaignPerformanceSnapshot(state, campaign) {
  const detail = campaignReportDetailSummary(state, campaign);
  const bounces = campaign.report?.bounces || 0;
  const unsubscribes = campaign.report?.unsubscribes || 0;
  return {
    campaignId: campaign.id,
    recipients: detail.recipients,
    opens: detail.opens,
    clicks: detail.clicks,
    openRate: detail.openRate,
    clickRate: detail.clickRate,
    bounceRate: detail.recipients ? Number(((bounces / detail.recipients) * 100).toFixed(2)) : 0,
    unsubscribeRate: detail.recipients ? Number(((unsubscribes / detail.recipients) * 100).toFixed(2)) : 0,
    funnel: detail.funnel,
    lastEventAt: detail.lastEventAt
  };
}

export function buildCampaignFollowupPlan(state, campaign) {
  const performance = campaignPerformanceSnapshot(state, campaign);
  const automation = campaignAutomationRuntimeSummary(state, campaign);
  const plan = [
    { step: 1, action: performance.openRate > 0 ? 'segment_openers' : 'send_subject_test', rationale: performance.openRate > 0 ? 'Openers are ready for a focused follow-up.' : 'No open signal yet; test subject and preheader first.' },
    { step: 2, action: performance.clickRate > 0 ? 'retarget_clickers' : 'rewrite_primary_cta', rationale: performance.clickRate > 0 ? 'Clickers can receive stronger conversion intent.' : 'CTA needs clearer offer framing before resend.' },
    { step: 3, action: automation.liveAutomations ? 'monitor_automation_handoff' : 'create_followup_journey', rationale: automation.liveAutomations ? 'Existing journey can continue the campaign.' : 'No live follow-up journey is connected.' }
  ];
  return { campaignId: campaign.id, plan, performance, automation };
}

export function summarizeCampaignEditorReadiness(campaign) {
  const blockers = [];
  if (!campaign.subject) blockers.push('subject missing');
  if (!campaign.preheader) blockers.push('preheader missing');
  if (!campaign.templateId) blockers.push('template missing');
  if (!campaign.blocks?.length) blockers.push('blocks missing');
  if (!campaign.editorSettings?.brandTone) blockers.push('brand tone not selected');
  const score = Math.max(0, Math.min(99, 92 - blockers.length * 12 + Math.min(6, (campaign.blocks || []).length * 2)));
  return { score, blockers, blockCount: campaign.blocks?.length || 0, readyForReview: blockers.length === 0 };
}

export function buildCampaignEditorNarrativeOutline(campaign) {
  return (campaign.blocks || []).map((block, index) => ({
    step: index + 1,
    sectionName: block.sectionName || `Section ${index + 1}`,
    title: block.title || block.type || `Section ${index + 1}`,
    role: index === 0 ? 'hook' : block.type === 'button' ? 'conversion' : 'supporting proof',
    hasCta: Boolean(block.buttonLabel || block.buttonUrl)
  }));
}

export function buildCampaignEditorLayoutPreset(campaign = {}, options = {}) {
  const presetId = options.preset || campaign.editorSettings?.preset || 'launch_story';
  const layout = GUIDED_CAMPAIGN_LAYOUTS.find((entry) => entry.id === presetId) || GUIDED_CAMPAIGN_LAYOUTS[0];
  return layout.blocks.map((block, index) => ({
    id: block.id || `layout-${layout.id}-${index + 1}`,
    ...block,
    tone: campaign.editorSettings?.brandTone || campaign.tone || 'brand',
    audienceAngle: campaign.editorSettings?.audienceAngle || 'general'
  }));
}

export const campaignOpsCalendarWorkflowIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "campaign_ops_calendar_workflow",
  "focusGroup": "campaign_experimentation",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.campaign_ops_calendar_workflow::semantic-frontier-001#13-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildCampaignOpsCalendarWorkflowIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...campaignOpsCalendarWorkflowIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-current-product-ops.mjs","packages/app/experiment-engine.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: campaignOpsCalendarWorkflowIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: campaignOpsCalendarWorkflowIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: campaignOpsCalendarWorkflowIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const campaignOpsCalendarWorkflowPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "campaign_ops_calendar_workflow",
  "focusGroup": "campaign_experimentation",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.campaign_ops_calendar_workflow::semantic-frontier-001#13-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildCampaignOpsCalendarWorkflowPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...campaignOpsCalendarWorkflowPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-current-product-ops.mjs","packages/app/experiment-engine.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: campaignOpsCalendarWorkflowPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: campaignOpsCalendarWorkflowPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: campaignOpsCalendarWorkflowPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}



export function buildReportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionRuntimeKey = "reporting_metrics_pipeline:operational_persistence_and_jobs:packages/app/domain-campaigns.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionRuntimeKey, surfaceId: "reporting_metrics_pipeline", focusGroup: "reporting_analytics", phaseId: "operational_persistence_and_jobs", shardId: "focus.reporting_metrics_pipeline::semantic-frontier-001#03-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-campaigns.mjs", workspaceId, durableStateReady: Boolean(db), ...reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/analytics-events.mjs","packages/app/domain-campaigns.mjs","packages/app/job-handlers.mjs"], nextAction: reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:reporting_metrics_pipeline:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:reporting_metrics_pipeline:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: reportingMetricsPipelineOperationalPersistenceAndJobsPackagesAppDomainCampaignsMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-campaigns.mjs" } };
}



export function buildCampaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionRuntimeKey = "campaign_ops_calendar_workflow:primary_runtime_spine:packages/app/domain-campaigns.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionRuntimeKey, surfaceId: "campaign_ops_calendar_workflow", focusGroup: "campaign_experimentation", phaseId: "primary_runtime_spine", shardId: "focus.campaign_ops_calendar_workflow::semantic-frontier-001#03-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-campaigns.mjs", workspaceId, durableStateReady: Boolean(db), ...campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-current-product-ops.mjs","packages/app/experiment-engine.mjs"], nextAction: campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:campaign_ops_calendar_workflow:monitor_job_runtime_handoff" : "primary_runtime_spine:campaign_ops_calendar_workflow:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: campaignOpsCalendarWorkflowPrimaryRuntimeSpinePackagesAppDomainCampaignsMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-campaigns.mjs" } };
}



export function buildReportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionRuntimeKey = "reporting_metrics_pipeline:integrated_user_path_evidence:packages/app/domain-campaigns.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionRuntimeKey, surfaceId: "reporting_metrics_pipeline", focusGroup: "reporting_analytics", phaseId: "integrated_user_path_evidence", shardId: "focus.reporting_metrics_pipeline::semantic-frontier-001#06-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-campaigns.mjs", workspaceId, durableStateReady: Boolean(db), ...reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionRuntimeCounts, phaseRuntimeSignal: reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionPhaseRuntimeSignal, workflowEvidence: reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/analytics-events.mjs","packages/app/domain-campaigns.mjs","packages/app/routes/api-admin.mjs"], nextAction: reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:reporting_metrics_pipeline:monitor_job_runtime_handoff" : "integrated_user_path_evidence:reporting_metrics_pipeline:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: reportingMetricsPipelineIntegratedUserPathEvidencePackagesAppDomainCampaignsMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-campaigns.mjs" } };
}
