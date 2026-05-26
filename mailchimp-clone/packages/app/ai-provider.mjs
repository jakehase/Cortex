function normalizeGoal(value, fallback = 'engagement') {
  return String(value || fallback).trim() || fallback;
}

function recommendationMeta(kind, score, extras = {}) {
  return {
    provider: 'mailclone-ai-runtime',
    model: extras.model || 'mailclone-reasoner-v2',
    kind,
    confidence: Number((Math.max(0, Math.min(100, score)) / 100).toFixed(2)),
    generatedFrom: extras.generatedFrom || ['campaign context', 'audience heuristics', 'workspace signals']
  };
}

export const AI_PROVIDER_REGISTRY = Object.freeze({
  primary: {
    id: 'mailclone-predictive-orchestrator',
    provider: 'mailclone-ai-runtime',
    model: 'mailclone-predictive-orchestrator-v2',
    capabilities: ['next_best_action', 'campaign_optimization', 'journey_guidance', 'audience_prioritization'],
    evidenceContract: ['feature_store_snapshot', 'model_run_ledger', 'recommendation_lineage', 'human_acceptance_feedback']
  }
});

export function buildProviderRuntimeEnvelope(input = {}) {
  const provider = input.provider || AI_PROVIDER_REGISTRY.primary;
  return {
    provider: provider.provider,
    providerId: provider.id,
    model: input.model || provider.model,
    capabilities: [...provider.capabilities],
    evidenceContract: [...provider.evidenceContract],
    objective: normalizeGoal(input.objective, 'increase audience engagement'),
    generatedFrom: input.generatedFrom || ['predictive feature store', 'campaign state', 'audience lifecycle signals', 'engagement history'],
    confidencePolicy: 'score-weighted recommendations with explicit feature evidence and acceptance feedback'
  };
}

export function buildCampaignOptimizationBrief(campaign = {}, predictiveSummary = {}, body = {}) {
  const goal = normalizeGoal(body.goal || campaign.goal, 'engagement');
  const highIntent = Number(predictiveSummary.highIntent || 0);
  const totalContacts = Number(predictiveSummary.totalContacts || predictiveSummary.contacts || 0);
  const confidence = Math.min(94, 72 + Math.min(12, highIntent * 3) + Math.min(10, totalContacts));
  return {
    label: `${campaign.name || 'Campaign'} next-best optimization`,
    action: 'apply_campaign_optimization',
    rationale: `Prioritize the ${goal} objective for contacts with recent engagement, clear consent, and higher predictive fit.`,
    payload: {
      sendTimeWindow: body.sendTimeWindow || predictiveSummary.bestSendWindow || '09:00-11:00 local',
      predictiveSegment: body.predictiveSegment || (highIntent > 0 ? 'High-intent lifecycle contacts' : 'Warming lifecycle contacts'),
      fatigueGuardrail: body.fatigueGuardrail || '2 messages / 7 days',
      productRecommendation: body.productRecommendation || 'Personalized offer bundle'
    },
    meta: recommendationMeta('campaign_optimization', confidence, { model: 'mailclone-predictive-orchestrator-v2', generatedFrom: ['campaign setup', 'predictive feature store', 'contact engagement'] })
  };
}

export function buildLifecycleNextBestAction(contact = {}, features = {}, body = {}) {
  const score = Number(features.predictiveScore || contact.predictiveScore || 0);
  const channel = contact.phone && score >= 70 ? 'sms_plus_email' : 'email';
  const confidence = Math.min(92, 64 + Math.round(score / 4));
  return {
    label: `${contact.email || contact.firstName || 'Contact'} lifecycle action`,
    action: 'prioritize_contact_lifecycle',
    rationale: `Use ${channel.replace(/_/g, ' ')} because the contact has score ${score}, tier ${features.lifecycleTier || 'monitor'}, and ${features.activityCount || 0} recent activity signals.`,
    payload: {
      channel,
      lifecycleStage: features.lifecycleTier || 'monitor',
      guardrail: body.guardrail || 'respect consent and frequency caps'
    },
    meta: recommendationMeta('lifecycle_next_best_action', confidence, { model: 'mailclone-predictive-orchestrator-v2', generatedFrom: ['contact feature vector', 'lifecycle tier', 'channel consent'] })
  };
}

export function buildCampaignSubjectVariants(campaign, tone = 'confident', goal = 'engagement') {
  const base = campaign.name || 'Campaign';
  const normalizedGoal = normalizeGoal(goal);
  return [
    { text: `${base}: ${tone} update for ${normalizedGoal}`, rationale: 'Balances clarity with a goal-oriented hook.', score: 88, meta: recommendationMeta('subject', 88, { generatedFrom: ['campaign name', 'goal', 'tone'] }) },
    { text: `What’s new from ${base}?`, rationale: 'Curiosity-led subject line tuned for opens.', score: 84, meta: recommendationMeta('subject', 84, { generatedFrom: ['campaign name', 'audience curiosity'] }) },
    { text: `${base} | proof-led path to ${normalizedGoal}`, rationale: 'Benefit-first line for urgency and value framing.', score: 91, meta: recommendationMeta('subject', 91, { generatedFrom: ['campaign name', 'benefit framing', 'goal'] }) }
  ];
}

export function buildCampaignPreheaderVariants(campaign, tone = 'helpful') {
  const subject = campaign.subject || campaign.name || 'your update';
  return [
    { text: `Preview the highlights, links, and next steps behind ${subject}.`, rationale: 'Complements the subject with clear value.', score: 87, meta: recommendationMeta('preheader', 87, { generatedFrom: ['subject line', 'campaign body'] }) },
    { text: `A ${tone} walkthrough of what matters most in this send.`, rationale: 'Frames the preheader as a guided skim.', score: 82, meta: recommendationMeta('preheader', 82, { generatedFrom: ['tone', 'subject line'] }) },
    { text: 'Open for the key changes, proof points, and CTA.', rationale: 'Calls out scan-friendly content depth.', score: 85, meta: recommendationMeta('preheader', 85, { generatedFrom: ['CTA', 'proof points'] }) }
  ];
}

export function buildCampaignBlockVariants(block = {}, tone = 'direct', goal = 'conversion') {
  const title = block.title || 'Headline';
  const body = block.body || 'Explain the value proposition.';
  const normalizedGoal = normalizeGoal(goal, 'conversion');
  return [
    { title: `${title} that drives ${normalizedGoal}`, body: `${body} Rewrite with a ${tone} tone and finish with a crisp proof point.`, buttonLabel: block.buttonLabel || 'Explore now', rationale: 'Lead with intent, then tighten the proof.', proofPoints: ['Clear outcome', 'Tighter proof', 'Action-first CTA'], meta: recommendationMeta('content_block', 89, { generatedFrom: ['block copy', 'campaign goal', 'tone'] }) },
    { title: `${title} for decision-ready readers`, body: `Use a ${tone} opener, shorten the middle, and turn the CTA toward ${normalizedGoal}.`, buttonLabel: block.buttonLabel || 'See details', rationale: 'Optimized for scannability and action.', proofPoints: ['Shorter middle', 'Decision-stage CTA'], meta: recommendationMeta('content_block', 86, { generatedFrom: ['block title', 'CTA intent'] }) },
    { title: `${title} with measurable next steps`, body: `Condense the message, name the outcome, and close with a CTA that makes ${normalizedGoal} obvious.`, buttonLabel: block.buttonLabel || 'Get started', rationale: 'Best when the block needs a sharper conversion path.', proofPoints: ['Explicit outcome', 'Measured next action'], meta: recommendationMeta('content_block', 90, { generatedFrom: ['desired outcome', 'CTA clarity'] }) }
  ];
}

export function buildJourneyRecommendation(automation = {}, body = {}) {
  const goal = normalizeGoal(body.goal || automation.goal, 'engagement');
  return {
    nodes: [
      { type: 'email', title: 'AI welcome touch' },
      { type: 'delay', title: 'Wait 24 hours', delayHours: 24 },
      { type: 'sms', title: 'SMS nudge for high-intent contacts' },
      { type: 'branch', title: 'Opened or clicked?', conditions: ['opened', 'clicked'] },
      { type: 'social', title: 'Retarget social audience reminder' }
    ],
    rationale: `Sequence uses email, sms, and social touches to move contacts toward ${goal}.`,
    trustSignals: ['Uses existing trigger context', 'Respects multi-channel consent', 'Adds a measurable branch for optimization'],
    sendTimeRecommendation: { window: '09:00-11:00 local', rationale: 'Prioritizes recent-engagement windows before fatigue risk rises.' },
    audienceSignals: ['vip', 'recent clickers', 'high-intent contacts'],
    meta: recommendationMeta('journey', 89, { generatedFrom: ['automation goal', 'channel mix', 'engagement timing'] })
  };
}

export function buildWebsiteCopyRecommendation(website = {}, body = {}) {
  const goal = normalizeGoal(body.goal, 'lead capture');
  return {
    headline: `${website.name || 'Your brand'} built for ${goal}`,
    body: `Lead with the core promise, explain why the offer matters now, and connect the page to the next best action for ${goal}.`,
    ctaLabel: body.ctaLabel || 'Join the list',
    rationale: 'Uses clear promise, proof, and action structure for homepage and landing copy.',
    proofPoints: ['Customer outcome first', 'Urgency without hype', 'CTA aligned to the next step'],
    sectionPlan: ['Promise', 'Proof', 'Offer', 'CTA'],
    meta: recommendationMeta('website_copy', 88, { generatedFrom: ['website name', 'goal', 'cta label'] })
  };
}
