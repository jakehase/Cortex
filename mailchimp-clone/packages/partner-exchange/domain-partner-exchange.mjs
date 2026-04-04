const PROGRAM = {
  id: 'partner-exchange',
  name: 'Partner Exchange',
  focus: 'marketplace packaging, partner readiness, and certification tracks',
  metrics: [
  'partners',
  'listings',
  'certifications'
],
  items: [
  'Partner tiering',
  'Listing readiness',
  'Certification queue'
]
};

export function createPartnerExchangeWorkspace(workspaceName = 'Demo workspace') {
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: PROGRAM.metrics.map((metric, index) => ({
      id: metric,
      label: metric.replace(/([A-Z])/g, ' $1').trim() || metric,
      value: (index + 1) * 7,
      posture: index % 2 === 0 ? 'healthy' : 'watch'
    })),
    workstreams: PROGRAM.items.map((item, index) => ({
      id: 'partner-exchange-ws-' + (index + 1),
      title: item,
      status: index === 0 ? 'active' : index === 1 ? 'planned' : 'monitoring'
    }))
  };
}

export function summarizePartnerExchange(workspace = createPartnerExchangeWorkspace()) {
  return {
    id: workspace.id,
    name: workspace.name,
    focus: workspace.focus,
    workspaceName: workspace.workspaceName,
    activeWorkstreams: workspace.workstreams.filter((entry) => entry.status === 'active').length,
    metricCount: workspace.scorecards.length,
    watchItems: workspace.scorecards.filter((entry) => entry.posture === 'watch').map((entry) => entry.id)
  };
}

export function validatePartnerExchangePlan(plan = {}) {
  const issues = [];
  if (!plan.owner) issues.push('missing_owner');
  if (!Array.isArray(plan.milestones) || plan.milestones.length < 2) issues.push('insufficient_milestones');
  if (!Array.isArray(plan.channels) || plan.channels.length < 1) issues.push('missing_distribution_channel');
  return {
    ok: issues.length === 0,
    issues,
    recommendedFocus: PROGRAM.focus
  };
}

export function createPartnerExchangeBrief(overrides = {}) {
  return {
    title: overrides.title || PROGRAM.name + ' rollout brief',
    owner: overrides.owner || 'ops-owner',
    channels: overrides.channels || ['email'],
    milestones: overrides.milestones || ['plan', 'stage', 'launch'],
    focus: PROGRAM.focus
  };
}
