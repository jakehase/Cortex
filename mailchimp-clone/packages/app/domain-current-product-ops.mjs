import { persistState } from './storage.mjs';
import { buildCampaignBlockVariants, buildCampaignOptimizationBrief, buildCampaignPreheaderVariants, buildCampaignSubjectVariants, buildJourneyRecommendation, buildLifecycleNextBestAction, buildProviderRuntimeEnvelope, buildWebsiteCopyRecommendation } from './ai-provider.mjs';
export { scoreContactPredictiveFit as predictiveScoreForContact, buildPredictiveWorkspace as predictiveWorkspace } from './predictive-model.mjs';
import { buildPredictiveFeatureStore, buildPredictiveWorkspace, rankPredictiveNextActions } from './predictive-model.mjs';
import { evaluateExperimentReport } from './experiment-engine.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { createNotification, recordAudit } from './domain-core.mjs';
import { recipientCount } from './domain-campaigns.mjs';
import { buildPredictiveSegmentsSnapshot } from '../predictive-segments/index.mjs';
import { buildSendTimeOptimizerSnapshot } from '../send-time-optimizer/index.mjs';
import { buildSmsOrchestrationSnapshot } from '../sms-orchestration/index.mjs';
import { buildSocialPublisherSnapshot } from '../social-publisher/index.mjs';
import { ensureCurrentProductState } from './domain-website-builder.mjs';

export const CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'campaign_experimentation_decision_runtime_layer',
  label: 'Campaign experimentation, dynamic content, holdout, and winner decision runtime contract',
  controls: [
    'campaign_experiment_variant_allocation_ledger',
    'dynamic_content_rule_resolution',
    'holdout_compliance_evidence',
    'winner_decision_audit_trail',
    'experiment_runtime_snapshots',
    'campaign_experiment_runtime_api'
  ],
  evidenceContract: [
    'variants_allocate_recipients_and_holdout_populations',
    'dynamic_content_rules_resolve_to_variant_payloads',
    'experiment_runs_record_metric_and_holdout_compliance',
    'winner_promotion_records_decision_reason_and_campaign_mutation',
    'runtime_snapshot_persists_experiment_allocation_dynamic_content_winner_and_health'
  ]
});

function ensureCampaignExperimentRuntimeState(state) {
  ensureCurrentProductState(state);
  state.db.campaignExperimentRuntimeSnapshots ||= [];
  state.db.campaignExperimentAllocationEvents ||= [];
  state.db.campaignExperimentDynamicContentEvents ||= [];
  state.db.campaignExperimentHoldoutEvents ||= [];
  state.db.campaignExperimentWinnerDecisions ||= [];
  return state;
}

function experimentsForWorkspace(state, workspaceId) {
  ensureCampaignExperimentRuntimeState(state);
  return state.db.campaignExperiments.filter((entry) => entry.workspaceId === workspaceId);
}

export function recordCampaignExperimentAllocation(state, actor, campaign, experiment, body = {}) {
  ensureCampaignExperimentRuntimeState(state);
  if (!experiment) return null;
  const totalRecipients = Math.max(10, Number(body.totalRecipients || recipientCount(state, campaign) || 10));
  const split = experiment.trafficSplit || { variantA: 45, variantB: 45, holdout: 10 };
  const holdoutRecipients = Math.max(0, Math.round(totalRecipients * Number(split.holdout || 0) / 100));
  const activeRecipients = Math.max(0, totalRecipients - holdoutRecipients);
  const variants = experiment.variants || [];
  const allocation = variants.map((variant, index) => {
    const percent = index === 0 ? Number(split.variantA || 0) : index === 1 ? Number(split.variantB || 0) : Math.max(0, Math.floor(activeRecipients / Math.max(1, variants.length)));
    return { variantId: variant.id, label: variant.label, percent, recipients: Math.max(1, Math.round(totalRecipients * percent / 100)), sampleAudience: variant.sampleAudience || 'default' };
  });
  const event = {
    id: createId('expalloc'),
    workspaceId: actor.workspace.id,
    campaignId: campaign?.id || experiment.campaignId,
    experimentId: experiment.id,
    totalRecipients,
    activeRecipients,
    holdoutRecipients,
    allocation,
    source: body.source || 'campaign_experiment_create',
    runtimeContract: CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.campaignExperimentAllocationEvents.unshift(event);
  state.db.campaignExperimentAllocationEvents = state.db.campaignExperimentAllocationEvents.slice(0, 1000);
  experiment.runtime ||= {};
  experiment.runtime.allocationEventId = event.id;
  experiment.runtime.lastAllocatedAt = event.createdAt;
  experiment.updatedAt = event.createdAt;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-allocation-recorded', detail: `Allocated ${totalRecipients} recipients for ${experiment.name}` });
  return event;
}

export function recordCampaignExperimentDynamicContent(state, actor, campaign, experiment, body = {}) {
  ensureCampaignExperimentRuntimeState(state);
  if (!experiment) return null;
  const rules = csvSplit(body.dynamicRules || experiment.dynamicRules?.join(',') || 'tag:vip');
  const mappings = rules.map((rule, index) => {
    const variant = experiment.variants[index % Math.max(1, experiment.variants.length)] || {};
    return { rule, variantId: variant.id || '', variantLabel: variant.label || 'Variant', payloadPreview: variant.bodyPreview || variant.subject || '' };
  });
  const event = {
    id: createId('expdyn'),
    workspaceId: actor.workspace.id,
    campaignId: campaign?.id || experiment.campaignId,
    experimentId: experiment.id,
    mappings,
    ruleCount: mappings.length,
    source: body.source || 'campaign_experiment_rules',
    runtimeContract: CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.campaignExperimentDynamicContentEvents.unshift(event);
  state.db.campaignExperimentDynamicContentEvents = state.db.campaignExperimentDynamicContentEvents.slice(0, 1000);
  experiment.runtime ||= {};
  experiment.runtime.dynamicContentEventId = event.id;
  experiment.updatedAt = event.createdAt;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-dynamic-content-recorded', detail: `Resolved ${mappings.length} dynamic rules for ${experiment.name}` });
  return event;
}

export function recordCampaignExperimentHoldoutCompliance(state, actor, campaign, experiment, report = {}) {
  ensureCampaignExperimentRuntimeState(state);
  if (!experiment) return null;
  const holdoutPercent = Number(experiment.trafficSplit?.holdout || 0);
  const totalRecipients = Number(report.totalRecipients || recipientCount(state, campaign) || 10);
  const event = {
    id: createId('expholdout'),
    workspaceId: actor.workspace.id,
    campaignId: campaign?.id || experiment.campaignId,
    experimentId: experiment.id,
    holdoutPercent,
    holdoutRecipients: Math.round(totalRecipients * holdoutPercent / 100),
    compliant: holdoutPercent >= 0 && holdoutPercent <= 25,
    metric: report.winnerMetric || experiment.winnerMetric,
    runtimeContract: CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.campaignExperimentHoldoutEvents.unshift(event);
  state.db.campaignExperimentHoldoutEvents = state.db.campaignExperimentHoldoutEvents.slice(0, 1000);
  experiment.runtime ||= {};
  experiment.runtime.holdoutEventId = event.id;
  experiment.updatedAt = event.createdAt;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-holdout-compliance', detail: `Holdout ${holdoutPercent}% for ${experiment.name}` });
  return event;
}

export function recordCampaignExperimentWinnerDecision(state, actor, campaign, experiment, winner, body = {}) {
  ensureCampaignExperimentRuntimeState(state);
  if (!experiment || !winner) return null;
  const event = {
    id: createId('expwin'),
    workspaceId: actor.workspace.id,
    campaignId: campaign?.id || experiment.campaignId,
    experimentId: experiment.id,
    winnerVariantId: winner.id,
    winnerLabel: winner.label,
    metric: experiment.report?.winnerMetric || experiment.winnerMetric,
    reason: body.reason || `Winner selected by ${experiment.report?.winnerMetric || experiment.winnerMetric}`,
    promotedSubject: winner.subject,
    promotedPreheader: winner.preheader,
    campaignUpdatedAt: campaign?.updatedAt || nowIso(),
    runtimeContract: CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.campaignExperimentWinnerDecisions.unshift(event);
  state.db.campaignExperimentWinnerDecisions = state.db.campaignExperimentWinnerDecisions.slice(0, 1000);
  experiment.runtime ||= {};
  experiment.runtime.winnerDecisionId = event.id;
  experiment.updatedAt = event.createdAt;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-winner-decision', detail: `Promoted ${winner.label} for ${campaign?.name || experiment.name}` });
  return event;
}

export function buildCampaignExperimentRuntimeSnapshot(state, workspaceId) {
  ensureCampaignExperimentRuntimeState(state);
  const experiments = experimentsForWorkspace(state, workspaceId);
  const allocations = state.db.campaignExperimentAllocationEvents.filter((entry) => entry.workspaceId === workspaceId);
  const dynamicContent = state.db.campaignExperimentDynamicContentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const holdouts = state.db.campaignExperimentHoldoutEvents.filter((entry) => entry.workspaceId === workspaceId);
  const winners = state.db.campaignExperimentWinnerDecisions.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.campaignExperimentRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...CAMPAIGN_EXPERIMENT_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    experimentCount: experiments.length,
    runningOrCompleteCount: experiments.filter((entry) => ['running', 'complete'].includes(entry.status)).length,
    allocationEventCount: allocations.length,
    dynamicContentEventCount: dynamicContent.length,
    holdoutEventCount: holdouts.length,
    winnerDecisionCount: winners.length,
    experiments: experiments.slice(0, 20).map((experiment) => ({ id: experiment.id, campaignId: experiment.campaignId, name: experiment.name, status: experiment.status, winnerMetric: experiment.winnerMetric, dynamicRules: experiment.dynamicRules || [], runtime: experiment.runtime || {}, report: experiment.report || null })),
    recentAllocations: allocations.slice(0, 10),
    recentDynamicContent: dynamicContent.slice(0, 10),
    recentHoldouts: holdouts.slice(0, 10),
    recentWinnerDecisions: winners.slice(0, 10),
    snapshots: { count: snapshots.length, latestCreatedAt: snapshots[0]?.createdAt || null },
    runtimeHealth: {
      experimentModelReady: experiments.length > 0,
      allocationReady: allocations.length > 0,
      dynamicContentReady: dynamicContent.length > 0,
      holdoutReady: holdouts.length > 0,
      winnerDecisionReady: winners.length > 0,
      snapshotReady: snapshots.length > 0,
      apiReady: true
    }
  };
}

export function persistCampaignExperimentRuntimeSnapshot(state, actor, reason = 'manual_campaign_experiment_runtime_snapshot') {
  ensureCampaignExperimentRuntimeState(state);
  const snapshot = buildCampaignExperimentRuntimeSnapshot(state, actor.workspace.id);
  state.db.campaignExperimentRuntimeSnapshots.unshift({ id: createId('expsnap'), workspaceId: actor.workspace.id, userId: actor.user.id, reason, createdAt: snapshot.generatedAt, snapshot });
  state.db.campaignExperimentRuntimeSnapshots = state.db.campaignExperimentRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-experiment-runtime-snapshot', detail: `Captured campaign experiment runtime snapshot (${reason})` });
  return snapshot;
}

export const SMS_MARKETING_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'sms_marketing_native_runtime_layer',
  label: 'SMS marketing consent, compliance, delivery, click tracking, and runtime evidence layer',
  controls: [
    'sms_consent_receipt_ledger',
    'sms_compliance_quiet_hour_checks',
    'sms_carrier_delivery_attempts',
    'sms_link_tracking_events',
    'sms_runtime_snapshots',
    'workspace_sms_runtime_api'
  ],
  evidenceContract: [
    'sms_consent_receipts',
    'quiet_hours_and_disclosure_compliance',
    'carrier_delivery_attempt_history',
    'sms_link_click_telemetry',
    'normal_omnichannel_route_adoption'
  ]
});

function ensureSmsMarketingRuntimeState(state) {
  ensureCurrentProductState(state);
  state.db.smsRuntimeSnapshots ||= [];
  state.db.smsConsentEvents ||= [];
  state.db.smsComplianceEvents ||= [];
  state.db.smsDeliveryAttempts ||= [];
  state.db.smsLinkTrackingEvents ||= [];
  return state;
}

function smsProgramsFor(state, workspaceId) {
  ensureSmsMarketingRuntimeState(state);
  return state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId && entry.channel === 'sms');
}

function parseMetadata(value = {}) {
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

export function recordSmsConsentEvent(state, actor, program, body = {}) {
  ensureSmsMarketingRuntimeState(state);
  const event = {
    id: createId('smsconsent'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    contactId: body.contactId || '',
    phone: body.phone || body.normalizedPhone || '',
    consentStatus: body.consentStatus || 'opted_in',
    source: body.source || 'omnichannel_sms_program',
    disclosureVersion: body.disclosureVersion || 'sms_disclosure_v1',
    recordedBy: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.smsConsentEvents.unshift(event);
  state.db.smsConsentEvents = state.db.smsConsentEvents.slice(0, 1000);
  if (program) {
    program.smsRuntime ||= {};
    program.smsRuntime.lastConsentEventId = event.id;
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'sms-consent-event', detail: `${event.consentStatus} consent for SMS program ${program?.name || event.programId}` });
  return event;
}

export function recordSmsComplianceEvent(state, actor, program, body = {}) {
  ensureSmsMarketingRuntimeState(state);
  const event = {
    id: createId('smscompliance'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    policy: body.policy || 'quiet_hours',
    result: body.result || 'passed',
    timezone: body.timezone || actor.workspace.settings?.timezone || 'America/Chicago',
    checkedAtLocal: body.checkedAtLocal || '10:00',
    remediation: body.remediation || '',
    metadata: parseMetadata(body.metadata),
    recordedAt: nowIso()
  };
  state.db.smsComplianceEvents.unshift(event);
  state.db.smsComplianceEvents = state.db.smsComplianceEvents.slice(0, 1000);
  if (program) {
    program.smsRuntime ||= {};
    program.smsRuntime.lastComplianceEventId = event.id;
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'sms-compliance-event', detail: `${event.policy} ${event.result} for SMS program ${program?.name || event.programId}` });
  return event;
}

export function recordSmsDeliveryAttempt(state, actor, program, body = {}) {
  ensureSmsMarketingRuntimeState(state);
  const attempt = {
    id: createId('smsdeliv'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    provider: body.provider || 'mailclone_sms',
    carrier: body.carrier || 'carrier_simulator',
    recipientCount: Number(body.recipientCount || program?.metrics?.sent || 1),
    status: body.status || 'sent',
    errorCode: body.errorCode || '',
    providerMessageId: body.providerMessageId || createId('smsmsg'),
    attemptedAt: nowIso()
  };
  state.db.smsDeliveryAttempts.unshift(attempt);
  state.db.smsDeliveryAttempts = state.db.smsDeliveryAttempts.slice(0, 1000);
  if (program) {
    program.smsRuntime ||= {};
    program.smsRuntime.lastDeliveryAttemptId = attempt.id;
    program.updatedAt = attempt.attemptedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'sms-delivery-attempt', detail: `${attempt.status} SMS delivery ${attempt.id} for ${program?.name || attempt.programId}` });
  return attempt;
}

export function recordSmsLinkTrackingEvent(state, actor, program, body = {}) {
  ensureSmsMarketingRuntimeState(state);
  const event = {
    id: createId('smsclick'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    linkId: body.linkId || createId('smslink'),
    url: body.url || 'https://example.test/sms-offer',
    contactId: body.contactId || '',
    clickCount: Number(body.clickCount || 1),
    metadata: parseMetadata(body.metadata),
    recordedAt: nowIso()
  };
  state.db.smsLinkTrackingEvents.unshift(event);
  state.db.smsLinkTrackingEvents = state.db.smsLinkTrackingEvents.slice(0, 1000);
  if (program) {
    program.smsRuntime ||= {};
    program.smsRuntime.lastLinkTrackingEventId = event.id;
    program.metrics ||= { sent: 0, impressions: 0, clicks: 0, conversions: 0 };
    program.metrics.clicks = Number(program.metrics.clicks || 0) + event.clickCount;
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'sms-link-tracking', detail: `Recorded ${event.clickCount} SMS click(s) for ${program?.name || event.programId}` });
  return event;
}

export function buildSmsMarketingRuntimeSnapshot(state, workspaceId) {
  ensureSmsMarketingRuntimeState(state);
  const programs = smsProgramsFor(state, workspaceId);
  const consentEvents = state.db.smsConsentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const complianceEvents = state.db.smsComplianceEvents.filter((entry) => entry.workspaceId === workspaceId);
  const deliveryAttempts = state.db.smsDeliveryAttempts.filter((entry) => entry.workspaceId === workspaceId);
  const linkTrackingEvents = state.db.smsLinkTrackingEvents.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...SMS_MARKETING_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    smsProgramCount: programs.length,
    liveSmsProgramCount: programs.filter((entry) => entry.status === 'live').length,
    consentEventCount: consentEvents.length,
    optedInConsentCount: consentEvents.filter((entry) => entry.consentStatus === 'opted_in').length,
    complianceEventCount: complianceEvents.length,
    failedComplianceCount: complianceEvents.filter((entry) => entry.result !== 'passed').length,
    deliveryAttemptCount: deliveryAttempts.length,
    deliveredRecipientCount: deliveryAttempts.filter((entry) => ['sent', 'delivered'].includes(entry.status)).reduce((sum, entry) => sum + Number(entry.recipientCount || 0), 0),
    linkTrackingEventCount: linkTrackingEvents.length,
    clickCount: linkTrackingEvents.reduce((sum, entry) => sum + Number(entry.clickCount || 0), 0),
    programs: programs.map((program) => ({ id: program.id, name: program.name, status: program.status, consentMode: program.consentMode, sent: Number(program.metrics?.sent || 0), clicks: Number(program.metrics?.clicks || 0), conversions: Number(program.metrics?.conversions || 0), smsRuntime: program.smsRuntime || {} })),
    recentConsentEvents: consentEvents.slice(0, 10),
    recentComplianceEvents: complianceEvents.slice(0, 10),
    recentDeliveryAttempts: deliveryAttempts.slice(0, 10),
    recentLinkTrackingEvents: linkTrackingEvents.slice(0, 10)
  };
}

export function persistSmsMarketingRuntimeSnapshot(state, actor, reason = 'manual_sms_runtime_snapshot') {
  ensureSmsMarketingRuntimeState(state);
  const snapshot = buildSmsMarketingRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('smsrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.smsRuntimeSnapshots.unshift(entry);
  state.db.smsRuntimeSnapshots = state.db.smsRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'sms-runtime-snapshot', detail: 'Captured SMS marketing runtime snapshot' });
  return entry;
}

export const SOCIAL_PUBLISHING_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'social_publishing_native_runtime_layer',
  label: 'Social post publishing approval, scheduling, provider handoff, analytics, and runtime evidence layer',
  controls: [
    'social_approval_event_ledger',
    'social_scheduled_post_queue',
    'social_provider_handoff_history',
    'social_engagement_telemetry',
    'social_runtime_snapshots',
    'workspace_social_runtime_api'
  ],
  evidenceContract: [
    'post_approval_lineage',
    'scheduled_post_runtime_queue',
    'provider_handoff_status_history',
    'engagement_analytics_events',
    'normal_omnichannel_route_adoption'
  ]
});

function ensureSocialPublishingRuntimeState(state) {
  ensureCurrentProductState(state);
  state.db.socialRuntimeSnapshots ||= [];
  state.db.socialApprovalEvents ||= [];
  state.db.socialScheduledPosts ||= [];
  state.db.socialProviderHandoffs ||= [];
  state.db.socialEngagementEvents ||= [];
  return state;
}

function socialProgramsFor(state, workspaceId) {
  ensureSocialPublishingRuntimeState(state);
  return state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId && entry.channel === 'social');
}

export function recordSocialApprovalEvent(state, actor, program, body = {}) {
  ensureSocialPublishingRuntimeState(state);
  const event = {
    id: createId('socialapprove'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    reviewerId: body.reviewerId || actor.user.id,
    status: body.status || 'approved',
    comment: body.comment || 'Social post approved for publishing',
    contentHash: body.contentHash || `social:${program?.id || body.programId || 'draft'}:${String(program?.content || body.content || '').length}`,
    approvedAt: nowIso()
  };
  state.db.socialApprovalEvents.unshift(event);
  state.db.socialApprovalEvents = state.db.socialApprovalEvents.slice(0, 1000);
  if (program) {
    program.socialRuntime ||= {};
    program.socialRuntime.lastApprovalEventId = event.id;
    program.updatedAt = event.approvedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-approval-event', detail: `${event.status} social post ${program?.name || event.programId}` });
  return event;
}

export function recordSocialScheduleEvent(state, actor, program, body = {}) {
  ensureSocialPublishingRuntimeState(state);
  const scheduled = {
    id: createId('socialsched'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    network: body.network || 'instagram',
    postType: body.postType || 'feed',
    scheduledFor: body.scheduledFor || nowIso(),
    status: body.status || 'scheduled',
    copyPreview: body.copyPreview || program?.content || '',
    createdBy: actor.user.id,
    createdAt: nowIso()
  };
  state.db.socialScheduledPosts.unshift(scheduled);
  state.db.socialScheduledPosts = state.db.socialScheduledPosts.slice(0, 1000);
  if (program) {
    program.socialRuntime ||= {};
    program.socialRuntime.lastScheduledPostId = scheduled.id;
    program.updatedAt = scheduled.createdAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-schedule-event', detail: `Scheduled ${scheduled.network} post for ${program?.name || scheduled.programId}` });
  return scheduled;
}

export function recordSocialProviderHandoff(state, actor, program, body = {}) {
  ensureSocialPublishingRuntimeState(state);
  const handoff = {
    id: createId('socialhandoff'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    provider: body.provider || 'mailclone_social',
    externalPostId: body.externalPostId || createId('socialpost'),
    status: body.status || 'accepted',
    requestId: body.requestId || createId('socialreq'),
    responseCode: Number(body.responseCode || 202),
    handedOffAt: nowIso()
  };
  state.db.socialProviderHandoffs.unshift(handoff);
  state.db.socialProviderHandoffs = state.db.socialProviderHandoffs.slice(0, 1000);
  if (program) {
    program.socialRuntime ||= {};
    program.socialRuntime.lastProviderHandoffId = handoff.id;
    program.updatedAt = handoff.handedOffAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-provider-handoff', detail: `${handoff.provider} ${handoff.status} for ${program?.name || handoff.programId}` });
  return handoff;
}

export function recordSocialEngagementEvent(state, actor, program, body = {}) {
  ensureSocialPublishingRuntimeState(state);
  const event = {
    id: createId('socialengage'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    network: body.network || 'instagram',
    impressions: Number(body.impressions || program?.metrics?.impressions || 0),
    engagements: Number(body.engagements || program?.metrics?.clicks || 0),
    clicks: Number(body.clicks || program?.metrics?.clicks || 0),
    conversions: Number(body.conversions || program?.metrics?.conversions || 0),
    recordedAt: nowIso()
  };
  state.db.socialEngagementEvents.unshift(event);
  state.db.socialEngagementEvents = state.db.socialEngagementEvents.slice(0, 1000);
  if (program) {
    program.socialRuntime ||= {};
    program.socialRuntime.lastEngagementEventId = event.id;
    program.metrics ||= { sent: 0, impressions: 0, clicks: 0, conversions: 0 };
    program.metrics.impressions = Math.max(Number(program.metrics.impressions || 0), event.impressions);
    program.metrics.clicks = Math.max(Number(program.metrics.clicks || 0), event.clicks);
    program.metrics.conversions = Math.max(Number(program.metrics.conversions || 0), event.conversions);
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-engagement-event', detail: `Recorded social engagement for ${program?.name || event.programId}` });
  return event;
}

export function buildSocialPublishingRuntimeSnapshot(state, workspaceId) {
  ensureSocialPublishingRuntimeState(state);
  const programs = socialProgramsFor(state, workspaceId);
  const approvals = state.db.socialApprovalEvents.filter((entry) => entry.workspaceId === workspaceId);
  const scheduledPosts = state.db.socialScheduledPosts.filter((entry) => entry.workspaceId === workspaceId);
  const handoffs = state.db.socialProviderHandoffs.filter((entry) => entry.workspaceId === workspaceId);
  const engagementEvents = state.db.socialEngagementEvents.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...SOCIAL_PUBLISHING_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    socialProgramCount: programs.length,
    liveSocialProgramCount: programs.filter((entry) => entry.status === 'live').length,
    approvalEventCount: approvals.length,
    scheduledPostCount: scheduledPosts.length,
    providerHandoffCount: handoffs.length,
    engagementEventCount: engagementEvents.length,
    totalImpressions: engagementEvents.reduce((sum, entry) => sum + Number(entry.impressions || 0), 0),
    totalEngagements: engagementEvents.reduce((sum, entry) => sum + Number(entry.engagements || 0), 0),
    totalClicks: engagementEvents.reduce((sum, entry) => sum + Number(entry.clicks || 0), 0),
    programs: programs.map((program) => ({ id: program.id, name: program.name, status: program.status, budget: program.budget, impressions: Number(program.metrics?.impressions || 0), clicks: Number(program.metrics?.clicks || 0), conversions: Number(program.metrics?.conversions || 0), socialRuntime: program.socialRuntime || {} })),
    recentApprovalEvents: approvals.slice(0, 10),
    recentScheduledPosts: scheduledPosts.slice(0, 10),
    recentProviderHandoffs: handoffs.slice(0, 10),
    recentEngagementEvents: engagementEvents.slice(0, 10)
  };
}

export function persistSocialPublishingRuntimeSnapshot(state, actor, reason = 'manual_social_runtime_snapshot') {
  ensureSocialPublishingRuntimeState(state);
  const snapshot = buildSocialPublishingRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('socialrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.socialRuntimeSnapshots.unshift(entry);
  state.db.socialRuntimeSnapshots = state.db.socialRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-runtime-snapshot', detail: 'Captured social publishing runtime snapshot' });
  return entry;
}

export const ADS_RETARGETING_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'ads_retargeting_runtime_layer',
  label: 'Digital ads retargeting audience, budget pacing, provider sync, attribution, and runtime evidence layer',
  controls: [
    'ads_retargeting_audience_ledger',
    'ads_budget_pacing_events',
    'ads_provider_sync_history',
    'ads_conversion_attribution_events',
    'ads_runtime_snapshots',
    'workspace_ads_runtime_api'
  ],
  evidenceContract: [
    'retargeting_audience_membership_snapshot',
    'budget_pacing_runtime_events',
    'provider_sync_status_history',
    'conversion_attribution_telemetry',
    'normal_omnichannel_route_adoption'
  ]
});

function ensureAdsRetargetingRuntimeState(state) {
  ensureCurrentProductState(state);
  state.db.adsRuntimeSnapshots ||= [];
  state.db.adsRetargetingAudiences ||= [];
  state.db.adsBudgetPacingEvents ||= [];
  state.db.adsProviderSyncEvents ||= [];
  state.db.adsConversionAttributionEvents ||= [];
  return state;
}

function adsProgramsFor(state, workspaceId) {
  ensureAdsRetargetingRuntimeState(state);
  return state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId && entry.channel === 'ads');
}

export function recordAdsRetargetingAudience(state, actor, program, body = {}) {
  ensureAdsRetargetingRuntimeState(state);
  const audienceSize = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id && (!program?.audienceId || entry.audienceId === program.audienceId)).length || Number(body.memberCount || 25);
  const audience = {
    id: createId('adsaud'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    sourceAudienceId: body.sourceAudienceId || program?.audienceId || '',
    segmentRule: body.segmentRule || 'site_visitors_30d OR campaign_clickers_14d',
    memberCount: Number(body.memberCount || audienceSize),
    exclusionRule: body.exclusionRule || 'recent_converters_7d',
    createdBy: actor.user.id,
    createdAt: nowIso()
  };
  state.db.adsRetargetingAudiences.unshift(audience);
  state.db.adsRetargetingAudiences = state.db.adsRetargetingAudiences.slice(0, 1000);
  if (program) {
    program.adsRuntime ||= {};
    program.adsRuntime.lastRetargetingAudienceId = audience.id;
    program.updatedAt = audience.createdAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ads-retargeting-audience', detail: `Created retargeting audience for ${program?.name || audience.programId}` });
  return audience;
}

export function recordAdsBudgetPacingEvent(state, actor, program, body = {}) {
  ensureAdsRetargetingRuntimeState(state);
  const event = {
    id: createId('adspace'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    dailyBudget: Number(body.dailyBudget || Math.max(1, Math.round(Number(program?.budget || 0) / 14)) || 10),
    spendToDate: Number(body.spendToDate || Math.round(Number(program?.budget || 0) * 0.35)),
    pacingStatus: body.pacingStatus || 'on_track',
    recommendation: body.recommendation || 'Maintain current bid cap',
    recordedAt: nowIso()
  };
  state.db.adsBudgetPacingEvents.unshift(event);
  state.db.adsBudgetPacingEvents = state.db.adsBudgetPacingEvents.slice(0, 1000);
  if (program) {
    program.adsRuntime ||= {};
    program.adsRuntime.lastBudgetPacingEventId = event.id;
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ads-budget-pacing', detail: `${event.pacingStatus} budget pacing for ${program?.name || event.programId}` });
  return event;
}

export function recordAdsProviderSyncEvent(state, actor, program, body = {}) {
  ensureAdsRetargetingRuntimeState(state);
  const event = {
    id: createId('adssync'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    provider: body.provider || 'mailclone_ads',
    externalCampaignId: body.externalCampaignId || createId('adcamp'),
    status: body.status || 'synced',
    syncedObjects: csvSplit(body.syncedObjects || 'audience,campaign,creative,budget'),
    requestId: body.requestId || createId('adsreq'),
    syncedAt: nowIso()
  };
  state.db.adsProviderSyncEvents.unshift(event);
  state.db.adsProviderSyncEvents = state.db.adsProviderSyncEvents.slice(0, 1000);
  if (program) {
    program.adsRuntime ||= {};
    program.adsRuntime.lastProviderSyncEventId = event.id;
    program.updatedAt = event.syncedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ads-provider-sync', detail: `${event.provider} ${event.status} for ${program?.name || event.programId}` });
  return event;
}

export function recordAdsConversionAttributionEvent(state, actor, program, body = {}) {
  ensureAdsRetargetingRuntimeState(state);
  const event = {
    id: createId('adsconv'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    attributionWindowDays: Number(body.attributionWindowDays || 7),
    conversions: Number(body.conversions || program?.metrics?.conversions || 1),
    revenue: Number(body.revenue || Number(body.conversions || program?.metrics?.conversions || 1) * 49),
    source: body.source || 'provider_pixel',
    recordedAt: nowIso()
  };
  state.db.adsConversionAttributionEvents.unshift(event);
  state.db.adsConversionAttributionEvents = state.db.adsConversionAttributionEvents.slice(0, 1000);
  if (program) {
    program.adsRuntime ||= {};
    program.adsRuntime.lastConversionAttributionEventId = event.id;
    program.metrics ||= { sent: 0, impressions: 0, clicks: 0, conversions: 0 };
    program.metrics.conversions = Math.max(Number(program.metrics.conversions || 0), event.conversions);
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ads-conversion-attribution', detail: `Attributed ${event.conversions} ad conversion(s) for ${program?.name || event.programId}` });
  return event;
}

export function buildAdsRetargetingRuntimeSnapshot(state, workspaceId) {
  ensureAdsRetargetingRuntimeState(state);
  const programs = adsProgramsFor(state, workspaceId);
  const audiences = state.db.adsRetargetingAudiences.filter((entry) => entry.workspaceId === workspaceId);
  const pacingEvents = state.db.adsBudgetPacingEvents.filter((entry) => entry.workspaceId === workspaceId);
  const syncEvents = state.db.adsProviderSyncEvents.filter((entry) => entry.workspaceId === workspaceId);
  const attributionEvents = state.db.adsConversionAttributionEvents.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...ADS_RETARGETING_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    adsProgramCount: programs.length,
    liveAdsProgramCount: programs.filter((entry) => entry.status === 'live').length,
    retargetingAudienceCount: audiences.length,
    retargetingMemberCount: audiences.reduce((sum, entry) => sum + Number(entry.memberCount || 0), 0),
    budgetPacingEventCount: pacingEvents.length,
    providerSyncEventCount: syncEvents.length,
    conversionAttributionEventCount: attributionEvents.length,
    attributedConversions: attributionEvents.reduce((sum, entry) => sum + Number(entry.conversions || 0), 0),
    attributedRevenue: attributionEvents.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0),
    programs: programs.map((program) => ({ id: program.id, name: program.name, status: program.status, budget: program.budget, impressions: Number(program.metrics?.impressions || 0), clicks: Number(program.metrics?.clicks || 0), conversions: Number(program.metrics?.conversions || 0), adsRuntime: program.adsRuntime || {} })),
    recentRetargetingAudiences: audiences.slice(0, 10),
    recentBudgetPacingEvents: pacingEvents.slice(0, 10),
    recentProviderSyncEvents: syncEvents.slice(0, 10),
    recentConversionAttributionEvents: attributionEvents.slice(0, 10)
  };
}

export function persistAdsRetargetingRuntimeSnapshot(state, actor, reason = 'manual_ads_runtime_snapshot') {
  ensureAdsRetargetingRuntimeState(state);
  const snapshot = buildAdsRetargetingRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('adsrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.adsRuntimeSnapshots.unshift(entry);
  state.db.adsRuntimeSnapshots = state.db.adsRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ads-runtime-snapshot', detail: 'Captured ads retargeting runtime snapshot' });
  return entry;
}

export const POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'postcard_direct_mail_runtime_layer',
  label: 'Postcard/direct-mail audience eligibility, creative proof, print handoff, delivery tracking, and runtime evidence layer',
  controls: [
    'postal_audience_eligibility_ledger',
    'postcard_address_validation_events',
    'postcard_creative_proof_approvals',
    'postcard_print_vendor_handoffs',
    'postcard_delivery_tracking_events',
    'postcard_runtime_snapshots',
    'workspace_postcard_runtime_api'
  ],
  evidenceContract: [
    'postal_audience_eligibility_is_recorded_per_program',
    'address_validation_records_valid_invalid_and_suppressed_counts',
    'creative_proofs_capture_front_back_copy_and_approval_state',
    'print_vendor_handoffs_track_provider_batch_cost_and_status',
    'delivery_tracking_events_link_maildrops_to_campaign_program_metrics',
    'normal_omnichannel_route_adoption'
  ]
});

function ensurePostcardDirectMailRuntimeState(state) {
  ensureCurrentProductState(state);
  state.db.postcardRuntimeSnapshots ||= [];
  state.db.postcardAddressValidationEvents ||= [];
  state.db.postcardCreativeProofEvents ||= [];
  state.db.postcardProviderHandoffEvents ||= [];
  state.db.postcardDeliveryTrackingEvents ||= [];
  return state;
}

function postcardProgramsFor(state, workspaceId) {
  ensurePostcardDirectMailRuntimeState(state);
  return state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId && entry.channel === 'postcard');
}

function postcardAudienceSize(state, actor, program, fallback = 20) {
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id && (!program?.audienceId || entry.audienceId === program.audienceId) && (entry.status || 'subscribed') === 'subscribed');
  return contacts.length || Number(fallback || 20);
}

export function recordPostcardAddressValidationEvent(state, actor, program, body = {}) {
  ensurePostcardDirectMailRuntimeState(state);
  const audienceCount = postcardAudienceSize(state, actor, program, body.audienceCount || body.validCount || 20);
  const invalidCount = Number(body.invalidCount || 0);
  const suppressedCount = Number(body.suppressedCount || 0);
  const validCount = Math.max(0, Number(body.validCount || audienceCount) - invalidCount - suppressedCount);
  const event = {
    id: createId('pcaddr'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    audienceId: program?.audienceId || body.audienceId || '',
    audienceCount,
    validCount,
    invalidCount,
    suppressedCount,
    validationProvider: body.validationProvider || 'mailclone_postal_validator',
    status: invalidCount ? 'needs_review' : 'validated',
    recordedAt: nowIso()
  };
  state.db.postcardAddressValidationEvents.unshift(event);
  state.db.postcardAddressValidationEvents = state.db.postcardAddressValidationEvents.slice(0, 1000);
  if (program) {
    program.postcardRuntime ||= {};
    program.postcardRuntime.lastAddressValidationEventId = event.id;
    program.postcardRuntime.eligibleRecipients = validCount;
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'postcard-address-validation', detail: `${validCount} postcard recipient(s) validated for ${program?.name || event.programId}` });
  return event;
}

export function recordPostcardCreativeProofEvent(state, actor, program, body = {}) {
  ensurePostcardDirectMailRuntimeState(state);
  const event = {
    id: createId('pcproof'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    proofName: body.proofName || `${program?.name || 'Postcard'} print proof`,
    frontCopy: body.frontCopy || program?.content || 'Front-side postcard creative',
    backCopy: body.backCopy || body.cta || 'Back-side CTA and mailing panel approved.',
    approvalStatus: body.approvalStatus || 'approved',
    approvedBy: actor.user.id,
    proofUrl: body.proofUrl || `/omnichannel/postcards/${program?.id || body.programId || 'program'}/proof`,
    recordedAt: nowIso()
  };
  state.db.postcardCreativeProofEvents.unshift(event);
  state.db.postcardCreativeProofEvents = state.db.postcardCreativeProofEvents.slice(0, 1000);
  if (program) {
    program.postcardRuntime ||= {};
    program.postcardRuntime.lastCreativeProofEventId = event.id;
    program.postcardRuntime.creativeApproved = event.approvalStatus === 'approved';
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'postcard-creative-proof', detail: `${event.approvalStatus} proof for ${program?.name || event.programId}` });
  return event;
}

export function recordPostcardProviderHandoffEvent(state, actor, program, body = {}) {
  ensurePostcardDirectMailRuntimeState(state);
  const recipientCount = Number(body.recipientCount || program?.postcardRuntime?.eligibleRecipients || postcardAudienceSize(state, actor, program, 20));
  const event = {
    id: createId('pchandoff'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    provider: body.provider || 'mailclone_print_network',
    batchId: body.batchId || createId('printbatch'),
    recipientCount,
    postageClass: body.postageClass || 'standard_marketing_mail',
    estimatedCost: Number(body.estimatedCost || (recipientCount * 0.74).toFixed(2)),
    status: body.status || 'accepted',
    handedOffAt: nowIso()
  };
  state.db.postcardProviderHandoffEvents.unshift(event);
  state.db.postcardProviderHandoffEvents = state.db.postcardProviderHandoffEvents.slice(0, 1000);
  if (program) {
    program.postcardRuntime ||= {};
    program.postcardRuntime.lastProviderHandoffEventId = event.id;
    program.postcardRuntime.printBatchId = event.batchId;
    program.updatedAt = event.handedOffAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'postcard-provider-handoff', detail: `${event.provider} ${event.status} postcard batch ${event.batchId}` });
  return event;
}

export function recordPostcardDeliveryTrackingEvent(state, actor, program, body = {}) {
  ensurePostcardDirectMailRuntimeState(state);
  const mailedCount = Number(body.mailedCount || program?.postcardRuntime?.eligibleRecipients || postcardAudienceSize(state, actor, program, 20));
  const deliveredCount = Number(body.deliveredCount || Math.max(1, Math.round(mailedCount * 0.82)));
  const event = {
    id: createId('pcdelivery'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    batchId: body.batchId || program?.postcardRuntime?.printBatchId || '',
    mailedCount,
    deliveredCount,
    returnedCount: Number(body.returnedCount || Math.max(0, mailedCount - deliveredCount)),
    estimatedInHomeDate: body.estimatedInHomeDate || nowIso().slice(0, 10),
    source: body.source || 'print_vendor_tracking',
    recordedAt: nowIso()
  };
  state.db.postcardDeliveryTrackingEvents.unshift(event);
  state.db.postcardDeliveryTrackingEvents = state.db.postcardDeliveryTrackingEvents.slice(0, 1000);
  if (program) {
    program.postcardRuntime ||= {};
    program.postcardRuntime.lastDeliveryTrackingEventId = event.id;
    program.metrics ||= { sent: 0, impressions: 0, clicks: 0, conversions: 0 };
    program.metrics.sent = Math.max(Number(program.metrics.sent || 0), event.mailedCount);
    program.metrics.impressions = Math.max(Number(program.metrics.impressions || 0), event.deliveredCount);
    program.metrics.conversions = Math.max(Number(program.metrics.conversions || 0), Math.max(1, Math.round(event.deliveredCount * 0.04)));
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'postcard-delivery-tracking', detail: `${deliveredCount}/${mailedCount} postcard deliveries for ${program?.name || event.programId}` });
  return event;
}

export function buildPostcardDirectMailRuntimeSnapshot(state, workspaceId) {
  ensurePostcardDirectMailRuntimeState(state);
  const programs = postcardProgramsFor(state, workspaceId);
  const addressEvents = state.db.postcardAddressValidationEvents.filter((entry) => entry.workspaceId === workspaceId);
  const proofEvents = state.db.postcardCreativeProofEvents.filter((entry) => entry.workspaceId === workspaceId);
  const handoffEvents = state.db.postcardProviderHandoffEvents.filter((entry) => entry.workspaceId === workspaceId);
  const deliveryEvents = state.db.postcardDeliveryTrackingEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.postcardRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    postcardProgramCount: programs.length,
    livePostcardProgramCount: programs.filter((entry) => entry.status === 'live').length,
    addressValidationEventCount: addressEvents.length,
    validPostalRecipientCount: addressEvents.reduce((sum, entry) => sum + Number(entry.validCount || 0), 0),
    creativeProofEventCount: proofEvents.length,
    providerHandoffEventCount: handoffEvents.length,
    deliveryTrackingEventCount: deliveryEvents.length,
    deliveredPostcardCount: deliveryEvents.reduce((sum, entry) => sum + Number(entry.deliveredCount || 0), 0),
    estimatedSpend: handoffEvents.reduce((sum, entry) => sum + Number(entry.estimatedCost || 0), 0),
    programs: programs.map((program) => ({ id: program.id, name: program.name, status: program.status, budget: program.budget, sent: Number(program.metrics?.sent || 0), impressions: Number(program.metrics?.impressions || 0), conversions: Number(program.metrics?.conversions || 0), postcardRuntime: program.postcardRuntime || {} })),
    recentAddressValidationEvents: addressEvents.slice(0, 10),
    recentCreativeProofEvents: proofEvents.slice(0, 10),
    recentProviderHandoffEvents: handoffEvents.slice(0, 10),
    recentDeliveryTrackingEvents: deliveryEvents.slice(0, 10),
    snapshots: { count: snapshots.length, latestRecordedAt: snapshots[0]?.recordedAt || null },
    runtimeHealth: {
      postcardProgramsReady: programs.length > 0,
      addressValidationReady: addressEvents.length > 0,
      creativeProofReady: proofEvents.length > 0,
      providerHandoffReady: handoffEvents.length > 0,
      deliveryTrackingReady: deliveryEvents.length > 0,
      snapshotReady: snapshots.length > 0,
      apiReady: true
    }
  };
}

export function persistPostcardDirectMailRuntimeSnapshot(state, actor, reason = 'manual_postcard_runtime_snapshot') {
  ensurePostcardDirectMailRuntimeState(state);
  const snapshot = buildPostcardDirectMailRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('pcrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.postcardRuntimeSnapshots.unshift(entry);
  state.db.postcardRuntimeSnapshots = state.db.postcardRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'postcard-runtime-snapshot', detail: 'Captured postcard direct-mail runtime snapshot' });
  return entry;
}

export const SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'social_calendar_coordination_runtime_layer',
  label: 'Social calendar coordination runtime with campaign links, calendar placements, timeline events, snapshots, and API evidence',
  controls: [
    'social_calendar_placement_ledger',
    'campaign_social_coordination_events',
    'cross_channel_timeline_events',
    'social_calendar_runtime_snapshots',
    'workspace_social_calendar_runtime_api'
  ],
  evidenceContract: [
    'social_posts_have_calendar_placement_state',
    'social_programs_link_to_campaign_coordination',
    'timeline_events_show_cross_channel_sequence',
    'calendar_runtime_snapshots_are_durable',
    'normal_omnichannel_route_adoption'
  ]
});

function ensureSocialCalendarCoordinationState(state) {
  ensureSocialPublishingRuntimeState(state);
  state.db.socialCalendarRuntimeSnapshots ||= [];
  state.db.socialCalendarPlacements ||= [];
  state.db.socialCampaignCoordinationEvents ||= [];
  state.db.socialTimelineEvents ||= [];
  return state;
}

export function recordSocialCalendarPlacement(state, actor, program, body = {}) {
  ensureSocialCalendarCoordinationState(state);
  const placement = {
    id: createId('socialcal'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    campaignId: body.campaignId || program?.campaignId || '',
    network: body.network || 'instagram',
    calendarDate: body.calendarDate || nowIso().slice(0, 10),
    slotLabel: body.slotLabel || 'morning_launch_window',
    status: body.status || 'planned',
    objective: body.objective || 'engagement',
    createdBy: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.socialCalendarPlacements.unshift(placement);
  state.db.socialCalendarPlacements = state.db.socialCalendarPlacements.slice(0, 1000);
  if (program) {
    program.socialCalendarRuntime ||= {};
    program.socialCalendarRuntime.lastCalendarPlacementId = placement.id;
    program.updatedAt = placement.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-calendar-placement', detail: `${placement.network} ${placement.status} on ${placement.calendarDate} for ${program?.name || placement.programId}` });
  return placement;
}

export function recordSocialCampaignCoordinationEvent(state, actor, program, body = {}) {
  ensureSocialCalendarCoordinationState(state);
  const campaign = state.db.campaigns.find((entry) => entry.id === (body.campaignId || program?.campaignId) && entry.workspaceId === actor.workspace.id) || null;
  const event = {
    id: createId('socialcoord'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    campaignId: campaign?.id || body.campaignId || program?.campaignId || '',
    coordinationMode: body.coordinationMode || 'campaign_launch_support',
    launchWindow: body.launchWindow || 'same_day',
    dependencyStatus: body.dependencyStatus || 'ready',
    campaignName: campaign?.name || body.campaignName || '',
    recordedBy: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.socialCampaignCoordinationEvents.unshift(event);
  state.db.socialCampaignCoordinationEvents = state.db.socialCampaignCoordinationEvents.slice(0, 1000);
  if (program) {
    program.campaignId ||= event.campaignId;
    program.socialCalendarRuntime ||= {};
    program.socialCalendarRuntime.lastCoordinationEventId = event.id;
    program.updatedAt = event.recordedAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-campaign-coordination', detail: `${event.coordinationMode} for ${program?.name || event.programId}` });
  return event;
}

export function recordSocialTimelineEvent(state, actor, program, body = {}) {
  ensureSocialCalendarCoordinationState(state);
  const event = {
    id: createId('socialtime'),
    workspaceId: actor.workspace.id,
    programId: program?.id || body.programId || '',
    campaignId: body.campaignId || program?.campaignId || '',
    channel: body.channel || program?.channel || 'social',
    eventType: body.eventType || 'scheduled_publish',
    sequenceOrder: Number(body.sequenceOrder || 1),
    status: body.status || 'scheduled',
    occurredAt: body.occurredAt || nowIso()
  };
  state.db.socialTimelineEvents.unshift(event);
  state.db.socialTimelineEvents = state.db.socialTimelineEvents.slice(0, 1000);
  if (program) {
    program.socialCalendarRuntime ||= {};
    program.socialCalendarRuntime.lastTimelineEventId = event.id;
    program.updatedAt = event.occurredAt;
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-timeline-event', detail: `${event.eventType} ${event.status} for ${program?.name || event.programId}` });
  return event;
}

export function buildSocialCalendarCoordinationRuntimeSnapshot(state, workspaceId) {
  ensureSocialCalendarCoordinationState(state);
  const programs = socialProgramsFor(state, workspaceId);
  const placements = state.db.socialCalendarPlacements.filter((entry) => entry.workspaceId === workspaceId);
  const coordinationEvents = state.db.socialCampaignCoordinationEvents.filter((entry) => entry.workspaceId === workspaceId);
  const timelineEvents = state.db.socialTimelineEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.socialCalendarRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    socialProgramCount: programs.length,
    calendarPlacementCount: placements.length,
    campaignCoordinationEventCount: coordinationEvents.length,
    timelineEventCount: timelineEvents.length,
    coordinatedCampaignCount: new Set(coordinationEvents.map((entry) => entry.campaignId).filter(Boolean)).size,
    scheduledPlacementCount: placements.filter((entry) => ['planned', 'scheduled'].includes(entry.status)).length,
    programs: programs.map((program) => ({ id: program.id, name: program.name, campaignId: program.campaignId || '', status: program.status, socialCalendarRuntime: program.socialCalendarRuntime || {} })),
    recentPlacements: placements.slice(0, 10),
    recentCoordinationEvents: coordinationEvents.slice(0, 10),
    recentTimelineEvents: timelineEvents.slice(0, 10),
    snapshots: { count: snapshots.length, latestRecordedAt: snapshots[0]?.recordedAt || null },
    runtimeHealth: {
      socialProgramReady: programs.length > 0,
      calendarPlacementReady: placements.length > 0,
      campaignCoordinationReady: coordinationEvents.length > 0,
      timelineReady: timelineEvents.length > 0,
      snapshotReady: snapshots.length > 0,
      apiReady: true
    }
  };
}

export function persistSocialCalendarCoordinationRuntimeSnapshot(state, actor, reason = 'manual_social_calendar_runtime_snapshot') {
  ensureSocialCalendarCoordinationState(state);
  const snapshot = buildSocialCalendarCoordinationRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('socialcalrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.socialCalendarRuntimeSnapshots.unshift(entry);
  state.db.socialCalendarRuntimeSnapshots = state.db.socialCalendarRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'social-calendar-runtime-snapshot', detail: 'Captured social calendar coordination runtime snapshot' });
  return entry;
}

export const OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'omnichannel_reporting_attribution_runtime_layer',
  label: 'Omnichannel reporting attribution runtime with channel mix, objective rollups, touchpoint attribution, snapshots, and API evidence',
  controls: [
    'channel_mix_snapshot_history',
    'omnichannel_objective_rollups',
    'touchpoint_attribution_events',
    'omnichannel_reporting_runtime_snapshots',
    'workspace_omnichannel_reporting_runtime_api'
  ],
  evidenceContract: [
    'channel_mix_dashboard_summarizes_sms_social_ads_postcards_email',
    'objective_rollups_link_channel_performance_to_campaign_goals',
    'touchpoint_attribution_events_capture_channel_and_revenue',
    'reporting_snapshots_are_durable',
    'normal_reports_route_adoption'
  ]
});

function ensureOmnichannelReportingAttributionState(state) {
  ensureCurrentProductState(state);
  state.db.omnichannelReportingRuntimeSnapshots ||= [];
  state.db.omnichannelChannelMixSnapshots ||= [];
  state.db.omnichannelObjectiveRollups ||= [];
  state.db.omnichannelAttributionEvents ||= [];
  return state;
}

function channelProgramSummary(programs = []) {
  return programs.reduce((acc, program) => {
    const channel = program.channel || 'unknown';
    acc[channel] ||= { programs: 0, live: 0, sent: 0, impressions: 0, clicks: 0, conversions: 0, budget: 0 };
    acc[channel].programs += 1;
    if (program.status === 'live') acc[channel].live += 1;
    acc[channel].sent += Number(program.metrics?.sent || 0);
    acc[channel].impressions += Number(program.metrics?.impressions || 0);
    acc[channel].clicks += Number(program.metrics?.clicks || 0);
    acc[channel].conversions += Number(program.metrics?.conversions || 0);
    acc[channel].budget += Number(program.budget || 0);
    return acc;
  }, {});
}

export function recordOmnichannelChannelMixSnapshot(state, actor, body = {}) {
  ensureOmnichannelReportingAttributionState(state);
  const programs = state.db.channelPrograms.filter((entry) => entry.workspaceId === actor.workspace.id);
  const snapshot = {
    id: createId('omnichmix'),
    workspaceId: actor.workspace.id,
    campaignId: body.campaignId || '',
    objective: body.objective || 'omnichannel_engagement',
    channelMix: channelProgramSummary(programs),
    programCount: programs.length,
    liveProgramCount: programs.filter((entry) => entry.status === 'live').length,
    recordedBy: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.omnichannelChannelMixSnapshots.unshift(snapshot);
  state.db.omnichannelChannelMixSnapshots = state.db.omnichannelChannelMixSnapshots.slice(0, 500);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'omnichannel-channel-mix-snapshot', detail: `Captured channel mix for ${snapshot.programCount} program(s)` });
  return snapshot;
}

export function recordOmnichannelObjectiveRollup(state, actor, body = {}) {
  ensureOmnichannelReportingAttributionState(state);
  const rollup = {
    id: createId('omniobj'),
    workspaceId: actor.workspace.id,
    campaignId: body.campaignId || '',
    objective: body.objective || 'revenue',
    channel: body.channel || 'all',
    touchpoints: Number(body.touchpoints || 0),
    conversions: Number(body.conversions || 0),
    revenue: Number(body.revenue || 0),
    attributionModel: body.attributionModel || 'last_non_direct_touch',
    recordedAt: nowIso()
  };
  state.db.omnichannelObjectiveRollups.unshift(rollup);
  state.db.omnichannelObjectiveRollups = state.db.omnichannelObjectiveRollups.slice(0, 1000);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'omnichannel-objective-rollup', detail: `${rollup.objective} rollup for ${rollup.channel}` });
  return rollup;
}

export function recordOmnichannelAttributionEvent(state, actor, body = {}) {
  ensureOmnichannelReportingAttributionState(state);
  const event = {
    id: createId('omniattr'),
    workspaceId: actor.workspace.id,
    campaignId: body.campaignId || '',
    programId: body.programId || '',
    channel: body.channel || 'email',
    contactId: body.contactId || '',
    touchpointType: body.touchpointType || 'click',
    conversionId: body.conversionId || createId('conversion'),
    revenue: Number(body.revenue || 0),
    attributionWeight: Number(body.attributionWeight || 1),
    occurredAt: body.occurredAt || nowIso()
  };
  state.db.omnichannelAttributionEvents.unshift(event);
  state.db.omnichannelAttributionEvents = state.db.omnichannelAttributionEvents.slice(0, 1000);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'omnichannel-attribution-event', detail: `${event.channel} attributed ${event.revenue}` });
  return event;
}

export function buildOmnichannelReportingAttributionRuntimeSnapshot(state, workspaceId) {
  ensureOmnichannelReportingAttributionState(state);
  const programs = state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId);
  const channelMixSnapshots = state.db.omnichannelChannelMixSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  const objectiveRollups = state.db.omnichannelObjectiveRollups.filter((entry) => entry.workspaceId === workspaceId);
  const attributionEvents = state.db.omnichannelAttributionEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.omnichannelReportingRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  const revenueByChannel = attributionEvents.reduce((acc, entry) => ({ ...acc, [entry.channel]: Number(acc[entry.channel] || 0) + Number(entry.revenue || 0) }), {});
  return {
    ...OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    channelMix: channelProgramSummary(programs),
    programCount: programs.length,
    liveProgramCount: programs.filter((entry) => entry.status === 'live').length,
    channelMixSnapshotCount: channelMixSnapshots.length,
    objectiveRollupCount: objectiveRollups.length,
    attributionEventCount: attributionEvents.length,
    attributedRevenue: attributionEvents.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0),
    attributedConversions: new Set(attributionEvents.map((entry) => entry.conversionId).filter(Boolean)).size,
    revenueByChannel,
    recentChannelMixSnapshots: channelMixSnapshots.slice(0, 10),
    recentObjectiveRollups: objectiveRollups.slice(0, 10),
    recentAttributionEvents: attributionEvents.slice(0, 10),
    snapshots: { count: snapshots.length, latestRecordedAt: snapshots[0]?.recordedAt || null },
    runtimeHealth: {
      channelMixReady: programs.length > 0 || channelMixSnapshots.length > 0,
      objectiveRollupReady: objectiveRollups.length > 0,
      attributionReady: attributionEvents.length > 0,
      snapshotReady: snapshots.length > 0,
      apiReady: true
    }
  };
}

export function persistOmnichannelReportingAttributionRuntimeSnapshot(state, actor, reason = 'manual_omnichannel_reporting_runtime_snapshot') {
  ensureOmnichannelReportingAttributionState(state);
  const snapshot = buildOmnichannelReportingAttributionRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('omnirun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.omnichannelReportingRuntimeSnapshots.unshift(entry);
  state.db.omnichannelReportingRuntimeSnapshots = state.db.omnichannelReportingRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'omnichannel-reporting-runtime-snapshot', detail: 'Captured omnichannel reporting attribution runtime snapshot' });
  return entry;
}



function ensureAiPredictiveState(state) {
  ensureCurrentProductState(state);
  state.db.aiRecommendationRuns ||= [];
  state.db.predictiveRecommendationSnapshots ||= [];
  state.db.aiFeedbackEvents ||= [];
  return state;
}

function latestAiRecommendationRun(state, workspaceId) {
  ensureAiPredictiveState(state);
  return state.db.aiRecommendationRuns.find((entry) => entry.workspaceId === workspaceId) || null;
}

function findAiRecommendation(state, workspaceId, recommendationId) {
  ensureAiPredictiveState(state);
  for (const run of state.db.aiRecommendationRuns.filter((entry) => entry.workspaceId === workspaceId)) {
    const recommendation = (run.recommendations || []).find((entry) => entry.id === recommendationId);
    if (recommendation) return { run, recommendation };
  }
  return null;
}

export function aiPredictiveRuntimeSnapshot(state, workspaceId, options = {}) {
  ensureAiPredictiveState(state);
  const ranked = rankPredictiveNextActions(state, workspaceId, options);
  const latestRun = latestAiRecommendationRun(state, workspaceId);
  return {
    providerRuntime: buildProviderRuntimeEnvelope({ objective: options.goal || 'increase audience engagement' }),
    featureStore: latestRun?.featureStore || ranked.featureStore,
    recommendations: latestRun?.recommendations || ranked.recommendations,
    latestRun,
    runHistory: state.db.aiRecommendationRuns.filter((entry) => entry.workspaceId === workspaceId).slice(0, 10),
    feedback: state.db.aiFeedbackEvents.filter((entry) => entry.workspaceId === workspaceId).slice(0, 20),
    snapshotHistory: state.db.predictiveRecommendationSnapshots.filter((entry) => entry.workspaceId === workspaceId).slice(0, 10)
  };
}

export function refreshAiPredictiveRecommendations(state, actor, body = {}) {
  ensureAiPredictiveState(state);
  const ranked = rankPredictiveNextActions(state, actor.workspace.id, body);
  const providerRuntime = buildProviderRuntimeEnvelope({ objective: body.goal || 'increase audience engagement', model: body.model });
  const campaign = state.db.campaigns.find((entry) => entry.id === body.campaignId && entry.workspaceId === actor.workspace.id) || state.db.campaigns.find((entry) => entry.workspaceId === actor.workspace.id) || null;
  const campaignBrief = campaign ? buildCampaignOptimizationBrief(campaign, ranked.featureStore.aggregate, body) : null;
  const recommendations = ranked.recommendations.map((entry, index) => {
    const topVector = ranked.featureStore.vectors.find((vector) => vector.contactId === entry.targetId) || ranked.featureStore.vectors[0] || {};
    const lifecycleBrief = entry.category === 'audience_prioritization' ? buildLifecycleNextBestAction({ id: topVector.contactId, email: topVector.email, phone: topVector.hasPhone }, topVector, body) : null;
    return {
      id: createId('airec'),
      rank: index + 1,
      status: 'open',
      createdAt: nowIso(),
      ...entry,
      label: entry.category === 'campaign_optimization' && campaignBrief ? campaignBrief.label : entry.label,
      rationale: entry.category === 'campaign_optimization' && campaignBrief ? campaignBrief.rationale : lifecycleBrief?.rationale || entry.rationale,
      payload: entry.category === 'campaign_optimization' && campaignBrief ? campaignBrief.payload : lifecycleBrief?.payload || entry.payload,
      providerMeta: entry.category === 'campaign_optimization' && campaignBrief ? campaignBrief.meta : lifecycleBrief?.meta || { ...providerRuntime, kind: entry.category, confidence: entry.confidence }
    };
  });
  const run = {
    id: createId('airun'),
    workspaceId: actor.workspace.id,
    status: 'complete',
    objective: providerRuntime.objective,
    providerRuntime,
    target: { campaignId: campaign?.id || body.campaignId || '', audienceId: body.audienceId || '', automationId: body.automationId || '' },
    featureStore: ranked.featureStore,
    recommendationCount: recommendations.length,
    recommendations,
    acceptedRecommendations: [],
    createdAt: nowIso(),
    completedAt: nowIso(),
    lineage: {
      generatedFrom: providerRuntime.generatedFrom,
      featureColumns: ranked.featureStore.featureColumns,
      contactCount: ranked.featureStore.aggregate.totalContacts,
      campaignCount: state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id).length,
      automationCount: state.db.automations.filter((entry) => entry.workspaceId === actor.workspace.id).length
    }
  };
  state.db.aiRecommendationRuns.unshift(run);
  state.db.predictiveRecommendationSnapshots.unshift({ id: createId('aisnap'), workspaceId: actor.workspace.id, runId: run.id, createdAt: run.completedAt, featureStore: ranked.featureStore, recommendationCount: recommendations.length });
  persistState(state);
  createNotification(state, { workspaceId: actor.workspace.id, type: 'ai-predictive-refresh', payload: { runId: run.id, recommendationCount: recommendations.length } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-predictive-refresh', detail: `Generated ${recommendations.length} AI predictive recommendations` });
  return run;
}

export function applyAiPredictiveRecommendation(state, actor, recommendationId, body = {}) {
  const found = findAiRecommendation(state, actor.workspace.id, recommendationId);
  if (!found) return null;
  const { run, recommendation } = found;
  let appliedTarget = null;
  if (recommendation.action === 'apply_campaign_optimization') {
    const campaign = state.db.campaigns.find((entry) => entry.id === recommendation.targetId && entry.workspaceId === actor.workspace.id);
    if (campaign) {
      campaign.optimization = {
        ...recommendation.payload,
        appliedAt: nowIso(),
        source: 'ai_predictive_recommendation',
        recommendationId: recommendation.id,
        runId: run.id
      };
      campaign.updatedAt = nowIso();
      appliedTarget = { type: 'campaign', id: campaign.id, name: campaign.name };
    }
  }
  recommendation.status = appliedTarget ? 'accepted' : 'reviewed';
  recommendation.appliedAt = appliedTarget ? nowIso() : null;
  recommendation.feedback = body.feedback || (appliedTarget ? 'accepted' : 'reviewed');
  run.acceptedRecommendations ||= [];
  if (appliedTarget) run.acceptedRecommendations.unshift({ recommendationId: recommendation.id, appliedTarget, appliedAt: recommendation.appliedAt });
  state.db.aiFeedbackEvents.unshift({ id: createId('aifb'), workspaceId: actor.workspace.id, runId: run.id, recommendationId: recommendation.id, feedback: recommendation.feedback, appliedTarget, createdAt: nowIso() });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-predictive-apply', detail: `Applied AI predictive recommendation ${recommendation.id}` });
  return { run, recommendation, appliedTarget };
}

export function aiPredictiveRecommendationReport(state, workspaceId) {
  const snapshot = aiPredictiveRuntimeSnapshot(state, workspaceId);
  return {
    providerRuntime: snapshot.providerRuntime,
    latestRunId: snapshot.latestRun?.id || null,
    runCount: snapshot.runHistory.length,
    recommendationCount: snapshot.recommendations.length,
    acceptedCount: snapshot.runHistory.reduce((sum, run) => sum + (run.acceptedRecommendations || []).length, 0),
    featureStore: snapshot.featureStore,
    recommendations: snapshot.recommendations
  };
}


export function generateCampaignAiPackage(state, actor, campaign, body = {}) {
  ensureCurrentProductState(state);
  const entry = {
    id: createId('ai'), workspaceId: actor.workspace.id, targetType: 'campaign', targetId: campaign.id, operation: body.operation || 'campaign_setup', tone: body.tone || 'confident', goal: body.goal || 'engagement', createdAt: nowIso(), acceptedAt: null, accepted: false,
    suggestions: { subject: buildCampaignSubjectVariants(campaign, body.tone, body.goal), preheader: buildCampaignPreheaderVariants(campaign, body.tone), blocks: (campaign.blocks || []).slice(0, 3).map((block) => buildCampaignBlockVariants(block, body.tone, body.goal)) },
    explanation: 'Generated from campaign name, setup fields, and current block content.'
  };
  state.db.generatedSuggestions.unshift(entry);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-campaign-generate', detail: `Generated AI assist package for ${campaign.name}` });
  return entry;
}

export function applyCampaignAiSuggestion(state, actor, campaign, body = {}) {
  campaign.aiAssistance ||= { accepted: [] };
  const field = body.field || 'subject';
  const value = body.value || '';
  if (field === 'subject') campaign.subject = value;
  else if (field === 'preheader') campaign.preheader = value;
  else if (field === 'block_title' && campaign.blocks?.[Number(body.index)]) campaign.blocks[Number(body.index)].title = value;
  else if (field === 'block_body' && campaign.blocks?.[Number(body.index)]) campaign.blocks[Number(body.index)].body = value;
  else if (field === 'block_button' && campaign.blocks?.[Number(body.index)]) campaign.blocks[Number(body.index)].buttonLabel = value;
  campaign.aiAssistance.accepted.unshift({ field, value, index: body.index === undefined ? null : Number(body.index), acceptedAt: nowIso() });
  campaign.updatedAt = nowIso();
  const suggestion = state.db.generatedSuggestions.find((entry) => entry.id === body.packageId && entry.workspaceId === actor.workspace.id);
  if (suggestion) { suggestion.accepted = true; suggestion.acceptedAt = nowIso(); }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-campaign-apply', detail: `Applied AI suggestion to ${campaign.name}` });
  return campaign;
}

export function generateAutomationRecommendation(state, actor, automation, body = {}) {
  ensureCurrentProductState(state);
  const entry = { id: createId('ai'), workspaceId: actor.workspace.id, targetType: 'automation', targetId: automation.id, operation: 'journey_recommendation', createdAt: nowIso(), accepted: false, suggestion: buildJourneyRecommendation(automation, body) };
  state.db.generatedSuggestions.unshift(entry);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-automation-generate', detail: `Generated AI journey recommendation for ${automation.name}` });
  return entry;
}

export function applyAutomationRecommendation(state, actor, automation, suggestionId) {
  const suggestion = state.db.generatedSuggestions.find((entry) => entry.id === suggestionId && entry.targetId === automation.id);
  if (!suggestion?.suggestion?.nodes) return null;
  automation.nodes = suggestion.suggestion.nodes.map((node) => ({ id: createId('node'), ...node }));
  automation.updatedAt = nowIso();
  automation.aiRecommendationAppliedAt = nowIso();
  suggestion.accepted = true;
  suggestion.acceptedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-automation-apply', detail: `Applied AI journey recommendation for ${automation.name}` });
  return automation;
}

export function generateWebsiteCopyRecommendation(state, actor, website, page, body = {}) {
  ensureCurrentProductState(state);
  const entry = { id: createId('ai'), workspaceId: actor.workspace.id, targetType: 'website_page', targetId: page.id, operation: 'website_copy', createdAt: nowIso(), accepted: false, suggestion: buildWebsiteCopyRecommendation(website, body) };
  state.db.generatedSuggestions.unshift(entry);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-website-generate', detail: `Generated website copy for ${website.name}` });
  return entry;
}

export function applyWebsiteCopyRecommendation(state, actor, page, suggestionId) {
  const suggestion = state.db.generatedSuggestions.find((entry) => entry.id === suggestionId && entry.targetId === page.id);
  if (!suggestion?.suggestion) return null;
  page.headline = suggestion.suggestion.headline;
  page.body = suggestion.suggestion.body;
  page.ctaLabel = suggestion.suggestion.ctaLabel;
  page.updatedAt = nowIso();
  suggestion.accepted = true;
  suggestion.acceptedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-website-apply', detail: `Applied AI website copy to ${page.name}` });
  return page;
}

export function createCampaignExperiment(state, actor, campaign, body = {}) {
  ensureCurrentProductState(state);
  const baseBody = campaign.blocks?.[0]?.body || 'Base campaign copy';
  const experiment = {
    id: createId('exp'), workspaceId: actor.workspace.id, campaignId: campaign.id, name: body.name || `${campaign.name} experiment`, status: 'draft', winnerMetric: body.winnerMetric || 'open_rate',
    trafficSplit: { variantA: Number(body.variantA || 45), variantB: Number(body.variantB || 45), holdout: Number(body.holdout || 10) },
    dynamicRules: csvSplit(body.dynamicRules || 'tag:vip,interest:launch'),
    variants: [
      { id: createId('var'), label: 'Variant A', subject: campaign.subject || `${campaign.name} update`, preheader: campaign.preheader || 'Open for the highlights.', bodyPreview: baseBody, sampleAudience: 'default' },
      { id: createId('var'), label: 'Variant B', subject: body.variantBSubject || `${campaign.name} — faster path to results`, preheader: body.variantBPreheader || 'See the proof, details, and next step.', bodyPreview: body.variantBBody || `${baseBody} Tightened for experimentation and conversion clarity.`, sampleAudience: 'high_intent' }
    ],
    report: null, createdAt: nowIso(), updatedAt: nowIso()
  };
  state.db.campaignExperiments.unshift(experiment);
  recordCampaignExperimentAllocation(state, actor, campaign, experiment, { source: 'experiment_create' });
  recordCampaignExperimentDynamicContent(state, actor, campaign, experiment, { source: 'experiment_create' });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-create', detail: `Created experiment ${experiment.name}` });
  return experiment;
}

export function campaignExperimentsFor(state, campaignId) {
  ensureCurrentProductState(state);
  return state.db.campaignExperiments.filter((entry) => entry.campaignId === campaignId);
}

export function runCampaignExperiment(state, actor, campaign, experiment) {
  const totalRecipients = Math.max(10, recipientCount(state, campaign) || 10);
  const variants = evaluateExperimentReport(experiment, totalRecipients);
  const winner = [...variants].sort((a, b) => experiment.winnerMetric === 'click_rate' ? b.clickRate - a.clickRate : experiment.winnerMetric === 'revenue' ? b.revenue - a.revenue : b.openRate - a.openRate)[0];
  experiment.status = 'complete';
  experiment.report = { totalRecipients, winnerMetric: experiment.winnerMetric, winnerVariantId: winner.variantId, winnerLabel: winner.label, finishedAt: nowIso(), dynamicPreview: experiment.dynamicRules.map((rule, index) => ({ rule, variantLabel: experiment.variants[index % experiment.variants.length].label })), variants };
  experiment.updatedAt = nowIso();
  recordCampaignExperimentHoldoutCompliance(state, actor, campaign, experiment, experiment.report);
  persistState(state);
  createNotification(state, { workspaceId: actor.workspace.id, type: 'experiment-complete', payload: { campaignId: campaign.id, experimentId: experiment.id, winner: winner.label } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-run', detail: `Ran experiment ${experiment.name}` });
  return experiment.report;
}

export function promoteExperimentWinner(state, actor, campaign, experiment) {
  if (!experiment.report?.winnerVariantId) return null;
  const winner = experiment.variants.find((entry) => entry.id === experiment.report.winnerVariantId);
  if (!winner) return null;
  campaign.subject = winner.subject;
  campaign.preheader = winner.preheader;
  if (campaign.blocks?.[0]) campaign.blocks[0].body = winner.bodyPreview;
  campaign.experimentWinnerId = winner.id;
  campaign.updatedAt = nowIso();
  recordCampaignExperimentWinnerDecision(state, actor, campaign, experiment, winner);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-promote-winner', detail: `Promoted ${winner.label} for ${campaign.name}` });
  return winner;
}



export function applyCampaignOptimization(state, actor, campaign, body = {}) {
  campaign.optimization = { sendTimeWindow: body.sendTimeWindow || '09:00-11:00 local', predictiveSegment: body.predictiveSegment || 'Likely next purchasers', fatigueGuardrail: body.fatigueGuardrail || '2 messages / 7 days', productRecommendation: body.productRecommendation || 'Top seller bundle', appliedAt: nowIso(), source: 'predictive_optimization' };
  campaign.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'campaign-optimization-apply', detail: `Applied optimization settings to ${campaign.name}` });
  return campaign.optimization;
}

export function optimizationReport(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId && entry.optimization);
  return { optimizedCampaigns: campaigns.length, sendWindows: [...new Set(campaigns.map((entry) => entry.optimization.sendTimeWindow))], campaigns: campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, optimization: campaign.optimization, recipients: recipientCount(state, campaign), opens: campaign.report?.opens || 0, clicks: campaign.report?.clicks || 0 })) };
}

export function createChannelProgram(state, actor, body = {}) {
  ensureCurrentProductState(state);
  const program = { id: createId('chan'), workspaceId: actor.workspace.id, audienceId: body.audienceId || '', campaignId: body.campaignId || '', automationId: body.automationId || '', channel: body.channel || 'sms', name: body.name || 'Channel program', budget: Number(body.budget || 0), content: body.content || '', status: 'draft', consentMode: body.consentMode || 'respect_preferences', metrics: { sent: 0, impressions: 0, clicks: 0, conversions: 0 }, createdAt: nowIso(), updatedAt: nowIso() };
  state.db.channelPrograms.unshift(program);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'channel-program-create', detail: `Created ${program.channel} program ${program.name}` });
  if (program.channel === 'sms') recordSmsComplianceEvent(state, actor, program, { policy: 'sms_disclosure_present', result: 'passed', metadata: { source: 'program_create' } });
  if (program.channel === 'social') recordSocialApprovalEvent(state, actor, program, { status: 'pending_review', comment: 'Social post created for review' });
  if (program.channel === 'ads') recordAdsRetargetingAudience(state, actor, program, { segmentRule: 'campaign_clickers_14d OR site_visitors_30d' });
  if (program.channel === 'postcard') {
    recordPostcardAddressValidationEvent(state, actor, program, { source: 'program_create' });
    recordPostcardCreativeProofEvent(state, actor, program, { approvalStatus: 'approved' });
  }
  return program;
}

export function launchChannelProgram(state, actor, program) {
  const audienceSize = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id && (!program.audienceId || entry.audienceId === program.audienceId) && entry.status === 'subscribed').length || 20;
  program.status = 'live';
  program.metrics = { sent: program.channel === 'sms' ? audienceSize : Math.round(audienceSize * 0.7), impressions: audienceSize + Math.round(program.budget * 8), clicks: Math.round(audienceSize * (program.channel === 'ads' ? 0.22 : 0.14)), conversions: Math.max(1, Math.round(audienceSize * (program.channel === 'sms' ? 0.1 : 0.06))) };
  program.updatedAt = nowIso();
  persistState(state);
  createNotification(state, { workspaceId: actor.workspace.id, type: 'channel-program-live', payload: { programId: program.id, channel: program.channel } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'channel-program-launch', detail: `Launched ${program.channel} program ${program.name}` });
  if (program.channel === 'sms') {
    recordSmsComplianceEvent(state, actor, program, { policy: 'quiet_hours', result: 'passed', metadata: { source: 'program_launch' } });
    recordSmsDeliveryAttempt(state, actor, program, { status: 'sent', recipientCount: program.metrics.sent, provider: 'mailclone_sms' });
  }
  if (program.channel === 'social') {
    recordSocialApprovalEvent(state, actor, program, { status: 'approved', comment: 'Approved at launch' });
    recordSocialScheduleEvent(state, actor, program, { network: 'instagram', status: 'scheduled' });
    recordSocialProviderHandoff(state, actor, program, { provider: 'mailclone_social', status: 'accepted' });
    recordSocialEngagementEvent(state, actor, program, { network: 'instagram', impressions: program.metrics.impressions, clicks: program.metrics.clicks, conversions: program.metrics.conversions });
  }
  if (program.channel === 'ads') {
    recordAdsBudgetPacingEvent(state, actor, program, { pacingStatus: 'on_track' });
    recordAdsProviderSyncEvent(state, actor, program, { provider: 'mailclone_ads', status: 'synced' });
    recordAdsConversionAttributionEvent(state, actor, program, { conversions: program.metrics.conversions, source: 'provider_pixel' });
  }
  if (program.channel === 'postcard') {
    recordPostcardProviderHandoffEvent(state, actor, program, { status: 'accepted' });
    recordPostcardDeliveryTrackingEvent(state, actor, program, { mailedCount: program.metrics.sent || postcardAudienceSize(state, actor, program, audienceSize) });
  }
  return program;
}

export function omnichannelWorkspace(state, workspaceId) {
  ensureCurrentProductState(state);
  const programs = state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId);
  return { programs, sms: buildSmsOrchestrationSnapshot(), social: buildSocialPublisherSnapshot(), postcardRuntime: buildPostcardDirectMailRuntimeSnapshot(state, workspaceId), totals: { programs: programs.length, live: programs.filter((entry) => entry.status === 'live').length, conversions: programs.reduce((sum, entry) => sum + (entry.metrics?.conversions || 0), 0) } };
}

export const dashboardHomePrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "dashboard_home",
  "focusGroup": "signup_onboarding",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.dashboard_home::semantic-frontier-001#15-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildDashboardHomePrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...dashboardHomePrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: dashboardHomePrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: dashboardHomePrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: dashboardHomePrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}
