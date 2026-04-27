export function buildCampaignSubjectVariants(campaign, tone = 'confident', goal = 'engagement') {
  const base = campaign.name || 'Campaign';
  return [
    { text: `${base}: ${tone} update for ${goal}`, rationale: 'Balances clarity with a goal-oriented hook.', score: 88 },
    { text: `What’s new from ${base}?`, rationale: 'Curiosity-led subject line tuned for opens.', score: 84 },
    { text: `${base} — the fast path to ${goal}`, rationale: 'Benefit-first line for urgency and value framing.', score: 90 }
  ];
}

export function buildCampaignPreheaderVariants(campaign, tone = 'helpful') {
  const subject = campaign.subject || campaign.name || 'your update';
  return [
    { text: `Preview the highlights, links, and next steps behind ${subject}.`, rationale: 'Complements the subject with clear value.', score: 87 },
    { text: `A ${tone} walkthrough of what matters most in this send.`, rationale: 'Frames the preheader as a guided skim.', score: 82 },
    { text: 'Open for the key changes, proof points, and CTA.', rationale: 'Calls out scan-friendly content depth.', score: 85 }
  ];
}

export function buildCampaignBlockVariants(block = {}, tone = 'direct', goal = 'conversion') {
  const title = block.title || 'Headline';
  const body = block.body || 'Explain the value proposition.';
  return [
    { title: `${title} that drives ${goal}`, body: `${body} Rewrite with a ${tone} tone and finish with a crisp proof point.`, buttonLabel: block.buttonLabel || 'Explore now', rationale: 'Lead with intent, then tighten the proof.' },
    { title: `${title} for decision-ready readers`, body: `Use a ${tone} opener, shorten the middle, and turn the CTA toward ${goal}.`, buttonLabel: block.buttonLabel || 'See details', rationale: 'Optimized for scannability and action.' },
    { title: `${title} without the fluff`, body: `Condense the message, name the outcome, and close with a CTA that makes ${goal} obvious.`, buttonLabel: block.buttonLabel || 'Get started', rationale: 'Best when the block needs a sharper conversion path.' }
  ];
}

export function buildJourneyRecommendation(automation = {}, body = {}) {
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

export function buildWebsiteCopyRecommendation(website = {}, body = {}) {
  const goal = body.goal || 'lead capture';
  return {
    headline: `${website.name || 'Your brand'} built for ${goal}`,
    body: `Lead with the core promise, explain why the offer matters now, and connect the page to the next best action for ${goal}.`,
    ctaLabel: body.ctaLabel || 'Join the list',
    rationale: 'Uses clear promise + proof + action structure for homepage and landing copy.'
  };
}

export function scoreRecommendationSet(items = []) {
  const normalized = items.map((item) => Number(item?.score || 0)).filter((value) => Number.isFinite(value));
  if (!normalized.length) return { average: 0, strongest: null, weakest: null };
  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  const strongest = items.reduce((best, item) => (!best || Number(item?.score || 0) > Number(best?.score || 0) ? item : best), null);
  const weakest = items.reduce((worst, item) => (!worst || Number(item?.score || 0) < Number(worst?.score || 0) ? item : worst), null);
  return {
    average: Number(average.toFixed(2)),
    strongest,
    weakest
  };
}

export function buildCampaignOptimizationBrief(campaign = {}, body = {}) {
  const goal = body.goal || 'engagement';
  const tone = body.tone || 'confident';
  const subjects = buildCampaignSubjectVariants(campaign, tone, goal);
  const preheaders = buildCampaignPreheaderVariants(campaign, 'helpful');
  const blocks = buildCampaignBlockVariants({
    title: campaign.name || 'Campaign headline',
    body: campaign.preheader || 'Clarify the message hierarchy before send.',
    buttonLabel: body.ctaLabel || 'Review campaign'
  }, 'direct', goal);
  return {
    goal,
    tone,
    subjectSummary: scoreRecommendationSet(subjects),
    preheaderSummary: scoreRecommendationSet(preheaders),
    blockSummary: scoreRecommendationSet(blocks),
    recommendedSequence: [subjects[0], preheaders[0], blocks[0]].filter(Boolean)
  };
}

export function buildJourneyChannelMix(automation = {}, body = {}) {
  const recommendation = buildJourneyRecommendation(automation, body);
  const mix = recommendation.nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});
  return {
    goal: body.goal || automation.goal || 'engagement',
    mix,
    trustSignals: recommendation.trustSignals,
    primaryChannel: Object.entries(mix).sort((left, right) => right[1] - left[1])[0]?.[0] || 'email'
  };
}

export function buildWebsiteExperimentCopyPack(website = {}, body = {}) {
  const base = buildWebsiteCopyRecommendation(website, body);
  return {
    control: {
      headline: base.headline,
      body: base.body,
      ctaLabel: base.ctaLabel
    },
    variants: [
      {
        id: 'benefit-led',
        headline: `${website.name || 'Your brand'} turns attention into ${body.goal || 'lead capture'}`,
        body: 'Lead with the concrete outcome, add one proof point, and keep the CTA friction-light.',
        ctaLabel: body.ctaLabel || 'See how'
      },
      {
        id: 'proof-led',
        headline: `${website.name || 'Your brand'} gives visitors a faster reason to act`,
        body: 'Open with proof, name the audience problem, and point directly at the next step.',
        ctaLabel: body.ctaLabel || 'Get the guide'
      }
    ],
    rationale: 'Creates a lightweight website-copy experiment pack aligned to current product parity surfaces.'
  };
}
