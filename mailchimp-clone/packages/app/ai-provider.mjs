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
