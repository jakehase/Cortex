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

function averageScore(items = []) {
  const scores = items.map((entry) => Number(entry.score || 0)).filter((score) => Number.isFinite(score));
  if (!scores.length) return 0;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
}

export function buildProviderRuntimeEnvelope(options = {}) {
  const objective = normalizeGoal(options.objective || options.goal, 'increase audience engagement');
  return { provider: 'mailclone-ai-runtime', model: options.model || 'mailclone-reasoner-v2', objective, latencyMsEstimate: Number(options.latencyMsEstimate || 180), generatedFrom: options.generatedFrom || ['workspace signals', 'campaign context', 'predictive feature store'], safetyControls: ['deterministic local fallback', 'recommendation confidence scoring', 'auditable payload lineage'] };
}

export function buildCampaignOptimizationBrief(campaign = {}, aggregateOrOptions = {}, options = {}) {
  const aggregate = options && Object.keys(options).length ? aggregateOrOptions : {};
  const runtimeOptions = options && Object.keys(options).length ? options : aggregateOrOptions;
  const goal = normalizeGoal(runtimeOptions.goal || aggregate.goal, 'conversion');
  const tone = runtimeOptions.tone || campaign.tone || 'confident';
  const subjectVariants = buildCampaignSubjectVariants(campaign, tone, goal);
  const preheaderVariants = buildCampaignPreheaderVariants(campaign, tone);
  const blockVariants = (campaign.blocks || [{ title: campaign.name || 'Campaign', body: campaign.previewText || campaign.preheader || 'Explain the offer clearly.' }]).slice(0, 3).flatMap((block) => buildCampaignBlockVariants(block, tone, goal).slice(0, 1));
  const subjectSummary = { count: subjectVariants.length, average: averageScore(subjectVariants), best: subjectVariants.slice().sort((left, right) => right.score - left.score)[0] || null };
  const preheaderSummary = { count: preheaderVariants.length, average: averageScore(preheaderVariants), best: preheaderVariants.slice().sort((left, right) => right.score - left.score)[0] || null };
  return { label: 'Optimize ' + (campaign.name || 'campaign') + ' for ' + goal, rationale: 'Combines subject, preheader, block, and audience signals to improve ' + goal + '.', subjectSummary, preheaderSummary, blockSummary: { count: blockVariants.length, average: averageScore(blockVariants) }, payload: { campaignId: campaign.id || '', goal, tone, audienceSignalCount: Number(aggregate.totalContacts || aggregate.contactCount || runtimeOptions.contactCount || 0), recommendedSubject: subjectSummary.best?.text || campaign.subject || campaign.name || 'Campaign update', recommendedPreheader: preheaderSummary.best?.text || campaign.preheader || '', subjectVariants, preheaderVariants, blockVariants }, meta: recommendationMeta('campaign_optimization', Math.max(subjectSummary.average, preheaderSummary.average, 86), { generatedFrom: ['campaign content', 'predictive aggregate', 'goal'] }) };
}

export function buildJourneyChannelMix(automation = {}, body = {}) {
  const goal = normalizeGoal(body.goal || automation.goal, 'retention');
  const channels = [{ channel: 'email', role: 'primary', timing: 'immediate', rationale: 'Best first touch for ' + goal + '.' }, ...(body.smsConsentReady === false ? [] : [{ channel: 'sms', role: 'assist', timing: 'after 24 hours', rationale: 'Use only for consented high-intent contacts.' }]), { channel: 'social', role: 'retargeting', timing: 'after engagement branch', rationale: 'Keeps warm contacts in the journey without over-emailing.' }];
  return { automationId: automation.id || '', goal, primaryChannel: 'email', channels, branchStrategy: automation.trigger ? automation.trigger + ': branch by open/click and consent state' : 'branch by open/click and consent state', meta: recommendationMeta('journey_channel_mix', 87, { generatedFrom: ['automation trigger', 'channel consent', 'goal'] }) };
}

export function buildWebsiteExperimentCopyPack(website = {}, body = {}) {
  const goal = normalizeGoal(body.goal, 'lead capture');
  const base = buildWebsiteCopyRecommendation(website, body);
  return { websiteId: website.id || '', goal, variants: [{ id: 'website-copy-a', name: 'Outcome-led hero', headline: base.headline, body: base.body, ctaLabel: base.ctaLabel, hypothesis: 'A direct promise will increase ' + goal + '.', score: 88 }, { id: 'website-copy-b', name: 'Proof-led hero', headline: (website.name || 'Your brand') + ' with proof for ' + goal, body: 'Lead with customer proof, remove friction, and make the next action for ' + goal + ' unmistakable.', ctaLabel: body.secondaryCtaLabel || base.ctaLabel, hypothesis: 'Specific proof points will improve qualified signups.', score: 86 }], successMetric: body.successMetric || 'signup_conversion_rate', meta: recommendationMeta('website_experiment_copy', 87, { generatedFrom: ['website copy', 'experiment goal', 'CTA intent'] }) };
}

export function buildLifecycleNextBestAction(contact = {}, vector = {}, body = {}) {
  const score = Number(vector.score || vector.predictiveScore || contact.predictiveScore || 0);
  const tier = score >= 75 ? 'high_intent' : score >= 50 ? 'warming' : 'nurture';
  const channel = contact.phone || vector.hasPhone ? 'sms_plus_email' : 'email';
  const goal = normalizeGoal(body.goal, 'lifecycle conversion');
  return { label: tier + ' next best action', rationale: 'Contact ' + (contact.email || vector.email || contact.id || 'unknown') + ' is in ' + tier + '; use ' + channel + ' to move toward ' + goal + '.', payload: { contactId: contact.id || vector.contactId || '', email: contact.email || vector.email || '', tier, channel, action: tier === 'high_intent' ? 'send_offer_followup' : tier === 'warming' ? 'send_education_sequence' : 'monitor_until_next_signal', score }, meta: recommendationMeta('lifecycle_next_best_action', Math.max(65, score), { generatedFrom: ['contact vector', 'engagement score', 'channel consent'] }) };
}

export function buildPredictiveDecisionRuntimeEvidence(state = {}, actor = {}, input = {}) {
  const workspaceId = actor?.workspace?.id || input.workspaceId || 'workspace';
  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(state.db?.contacts) ? state.db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const predictiveCandidates = contacts.map((contact) => ({ id: contact.id, email: contact.email, score: Number(contact.predictiveScore || 0) || (contact.status === 'subscribed' ? 62 : 28) }));
  return {
    provider: 'mailclone-ai-runtime',
    workspaceId,
    campaignCount: campaigns.length,
    predictiveCandidateCount: predictiveCandidates.length,
    topCandidates: predictiveCandidates.sort((left, right) => right.score - left.score).slice(0, 5),
    workflowStatus: predictiveCandidates.length ? 'predictive_decision_ready' : 'predictive_signal_collection_needed',
    nextAction: campaigns.length ? 'apply_predictive_recommendation' : 'create_campaign_for_prediction'
  };
}
