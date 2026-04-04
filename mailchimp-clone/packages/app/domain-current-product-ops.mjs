import { saveDb } from './storage.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { createNotification, recordAudit } from './domain-core.mjs';
import { recipientCount } from './domain-campaigns.mjs';
import { buildPredictiveSegmentsSnapshot } from '../predictive-segments/index.mjs';
import { buildSendTimeOptimizerSnapshot } from '../send-time-optimizer/index.mjs';
import { buildSmsOrchestrationSnapshot } from '../sms-orchestration/index.mjs';
import { buildSocialPublisherSnapshot } from '../social-publisher/index.mjs';
import { ensureCurrentProductState } from './domain-website-builder.mjs';

function buildSubjectVariants(campaign, tone = 'confident', goal = 'engagement') {
  const base = campaign.name || 'Campaign';
  return [
    { text: `${base}: ${tone} update for ${goal}`, rationale: 'Balances clarity with a goal-oriented hook.', score: 88 },
    { text: `What’s new from ${base}?`, rationale: 'Curiosity-led subject line tuned for opens.', score: 84 },
    { text: `${base} — the fast path to ${goal}`, rationale: 'Benefit-first line for urgency and value framing.', score: 90 }
  ];
}

function buildPreheaderVariants(campaign, tone = 'helpful') {
  const subject = campaign.subject || campaign.name || 'your update';
  return [
    { text: `Preview the highlights, links, and next steps behind ${subject}.`, rationale: 'Complements the subject with clear value.', score: 87 },
    { text: `A ${tone} walkthrough of what matters most in this send.`, rationale: 'Frames the preheader as a guided skim.', score: 82 },
    { text: 'Open for the key changes, proof points, and CTA.', rationale: 'Calls out scan-friendly content depth.', score: 85 }
  ];
}

function buildBlockVariants(block = {}, tone = 'direct', goal = 'conversion') {
  const title = block.title || 'Headline';
  const body = block.body || 'Explain the value proposition.';
  return [
    { title: `${title} that drives ${goal}`, body: `${body} Rewrite with a ${tone} tone and finish with a crisp proof point.`, buttonLabel: block.buttonLabel || 'Explore now', rationale: 'Lead with intent, then tighten the proof.' },
    { title: `${title} for decision-ready readers`, body: `Use a ${tone} opener, shorten the middle, and turn the CTA toward ${goal}.`, buttonLabel: block.buttonLabel || 'See details', rationale: 'Optimized for scannability and action.' },
    { title: `${title} without the fluff`, body: `Condense the message, name the outcome, and close with a CTA that makes ${goal} obvious.`, buttonLabel: block.buttonLabel || 'Get started', rationale: 'Best when the block needs a sharper conversion path.' }
  ];
}

function buildJourneyRecommendation(automation = {}, body = {}) {
  const goal = body.goal || automation.goal || 'engagement';
  return {
    nodes: [
      { type: 'email', title: 'AI welcome touch' },
      { type: 'delay', title: 'Wait 24 hours', delayHours: 24 },
      { type: 'sms', title: 'SMS nudge for high-intent contacts' },
      { type: 'branch', title: 'Opened or clicked?', conditions: ['opened', 'clicked'] },
      { type: 'social', title: 'Retarget social audience reminder' }
    ],
    rationale: `Sequence uses email + sms + social touches to move contacts toward ${goal}.`,
    trustSignals: ['Uses existing trigger context', 'Respects multi-channel consent', 'Adds a measurable branch for optimization']
  };
}

function buildSiteCopyRecommendation(website = {}, body = {}) {
  const goal = body.goal || 'lead capture';
  return {
    headline: `${website.name || 'Your brand'} built for ${goal}`,
    body: `Lead with the core promise, explain why the offer matters now, and connect the page to the next best action for ${goal}.`,
    ctaLabel: body.ctaLabel || 'Join the list',
    rationale: 'Uses clear promise + proof + action structure for homepage and landing copy.'
  };
}

export function generateCampaignAiPackage(state, actor, campaign, body = {}) {
  ensureCurrentProductState(state);
  const entry = {
    id: createId('ai'), workspaceId: actor.workspace.id, targetType: 'campaign', targetId: campaign.id, operation: body.operation || 'campaign_setup', tone: body.tone || 'confident', goal: body.goal || 'engagement', createdAt: nowIso(), acceptedAt: null, accepted: false,
    suggestions: { subject: buildSubjectVariants(campaign, body.tone, body.goal), preheader: buildPreheaderVariants(campaign, body.tone), blocks: (campaign.blocks || []).slice(0, 3).map((block) => buildBlockVariants(block, body.tone, body.goal)) },
    explanation: 'Generated from campaign name, setup fields, and current block content.'
  };
  state.db.generatedSuggestions.unshift(entry);
  saveDb(state.db);
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-campaign-apply', detail: `Applied AI suggestion to ${campaign.name}` });
  return campaign;
}

export function generateAutomationRecommendation(state, actor, automation, body = {}) {
  ensureCurrentProductState(state);
  const entry = { id: createId('ai'), workspaceId: actor.workspace.id, targetType: 'automation', targetId: automation.id, operation: 'journey_recommendation', createdAt: nowIso(), accepted: false, suggestion: buildJourneyRecommendation(automation, body) };
  state.db.generatedSuggestions.unshift(entry);
  saveDb(state.db);
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'ai-automation-apply', detail: `Applied AI journey recommendation for ${automation.name}` });
  return automation;
}

export function generateWebsiteCopyRecommendation(state, actor, website, page, body = {}) {
  ensureCurrentProductState(state);
  const entry = { id: createId('ai'), workspaceId: actor.workspace.id, targetType: 'website_page', targetId: page.id, operation: 'website_copy', createdAt: nowIso(), accepted: false, suggestion: buildSiteCopyRecommendation(website, body) };
  state.db.generatedSuggestions.unshift(entry);
  saveDb(state.db);
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
  saveDb(state.db);
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-create', detail: `Created experiment ${experiment.name}` });
  return experiment;
}

export function campaignExperimentsFor(state, campaignId) {
  ensureCurrentProductState(state);
  return state.db.campaignExperiments.filter((entry) => entry.campaignId === campaignId);
}

export function runCampaignExperiment(state, actor, campaign, experiment) {
  const totalRecipients = Math.max(10, recipientCount(state, campaign) || 10);
  const variants = experiment.variants.map((variant, index) => ({ variantId: variant.id, label: variant.label, recipients: Math.round(totalRecipients * ((index === 0 ? experiment.trafficSplit.variantA : experiment.trafficSplit.variantB) / 100)), openRate: Math.min(0.78, 0.28 + (variant.subject.length % 9) * 0.03 + index * 0.02), clickRate: Math.min(0.45, 0.08 + (variant.bodyPreview.length % 11) * 0.012 + index * 0.01), revenue: Math.round(totalRecipients * (20 + (0.28 + (variant.subject.length % 9) * 0.03 + index * 0.02) * 100 + (0.08 + (variant.bodyPreview.length % 11) * 0.012 + index * 0.01) * 90)) }));
  const winner = [...variants].sort((a, b) => experiment.winnerMetric === 'click_rate' ? b.clickRate - a.clickRate : experiment.winnerMetric === 'revenue' ? b.revenue - a.revenue : b.openRate - a.openRate)[0];
  experiment.status = 'complete';
  experiment.report = { totalRecipients, winnerMetric: experiment.winnerMetric, winnerVariantId: winner.variantId, winnerLabel: winner.label, finishedAt: nowIso(), dynamicPreview: experiment.dynamicRules.map((rule, index) => ({ rule, variantLabel: experiment.variants[index % experiment.variants.length].label })), variants };
  experiment.updatedAt = nowIso();
  saveDb(state.db);
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'experiment-promote-winner', detail: `Promoted ${winner.label} for ${campaign.name}` });
  return winner;
}

export function predictiveScoreForContact(contact = {}) {
  let score = contact.status === 'subscribed' ? 38 : 10;
  score += Math.min(18, (contact.tags || []).length * 4);
  score += Math.min(16, (contact.interests || []).length * 4);
  score += Math.min(12, (contact.activity || []).length * 3);
  if (contact.phone) score += 6;
  if ((contact.notes || '').toLowerCase().includes('vip')) score += 8;
  return Math.max(0, Math.min(100, score));
}

export function predictiveWorkspace(state, workspaceId, audienceId = '') {
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => !audienceId || entry.audienceId === audienceId).map((contact) => {
    const predictiveScore = predictiveScoreForContact(contact);
    return { ...contact, predictiveScore, lifecycleTier: predictiveScore >= 75 ? 'high_intent' : predictiveScore >= 50 ? 'warming' : 'monitor' };
  }).sort((a, b) => b.predictiveScore - a.predictiveScore);
  return { contacts, highIntent: contacts.filter((entry) => entry.predictiveScore >= 75).length, recommendations: [{ id: 'predictive-rec-1', label: 'Likely next purchasers', criteria: 'predictiveScore >= 75' }, { id: 'predictive-rec-2', label: 'Re-engage with SMS fallback', criteria: 'predictiveScore between 50 and 74' }, { id: 'predictive-rec-3', label: 'Frequency cap / fatigue watch', criteria: 'predictiveScore < 50 and recent activity low' }], sendTime: buildSendTimeOptimizerSnapshot(), predictiveSegments: buildPredictiveSegmentsSnapshot() };
}

export function applyCampaignOptimization(state, actor, campaign, body = {}) {
  campaign.optimization = { sendTimeWindow: body.sendTimeWindow || '09:00-11:00 local', predictiveSegment: body.predictiveSegment || 'Likely next purchasers', fatigueGuardrail: body.fatigueGuardrail || '2 messages / 7 days', productRecommendation: body.productRecommendation || 'Top seller bundle', appliedAt: nowIso(), source: 'predictive_optimization' };
  campaign.updatedAt = nowIso();
  saveDb(state.db);
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
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'channel-program-create', detail: `Created ${program.channel} program ${program.name}` });
  return program;
}

export function launchChannelProgram(state, actor, program) {
  const audienceSize = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id && (!program.audienceId || entry.audienceId === program.audienceId) && entry.status === 'subscribed').length || 20;
  program.status = 'live';
  program.metrics = { sent: program.channel === 'sms' ? audienceSize : Math.round(audienceSize * 0.7), impressions: audienceSize + Math.round(program.budget * 8), clicks: Math.round(audienceSize * (program.channel === 'ads' ? 0.22 : 0.14)), conversions: Math.max(1, Math.round(audienceSize * (program.channel === 'sms' ? 0.1 : 0.06))) };
  program.updatedAt = nowIso();
  saveDb(state.db);
  createNotification(state, { workspaceId: actor.workspace.id, type: 'channel-program-live', payload: { programId: program.id, channel: program.channel } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'channel-program-launch', detail: `Launched ${program.channel} program ${program.name}` });
  return program;
}

export function omnichannelWorkspace(state, workspaceId) {
  ensureCurrentProductState(state);
  const programs = state.db.channelPrograms.filter((entry) => entry.workspaceId === workspaceId);
  return { programs, sms: buildSmsOrchestrationSnapshot(), social: buildSocialPublisherSnapshot(), totals: { programs: programs.length, live: programs.filter((entry) => entry.status === 'live').length, conversions: programs.reduce((sum, entry) => sum + (entry.metrics?.conversions || 0), 0) } };
}
