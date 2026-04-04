const PROGRAM = {
  id: 'content-library',
  name: 'Content Library',
  focus: 'brand kits, reusable blocks, and asset governance',
  metrics: [
  'collections',
  'blocks',
  'brands'
],
  items: [
  'Hero blocks',
  'Localization kits',
  'Brand guardrails'
]
};

export function createContentLibraryWorkspace(workspaceName = 'Demo workspace') {
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
      id: 'content-library-ws-' + (index + 1),
      title: item,
      status: index === 0 ? 'active' : index === 1 ? 'planned' : 'monitoring'
    }))
  };
}

export function summarizeContentLibrary(workspace = createContentLibraryWorkspace()) {
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

export function validateContentLibraryPlan(plan = {}) {
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

export function createContentLibraryBrief(overrides = {}) {
  return {
    title: overrides.title || PROGRAM.name + ' rollout brief',
    owner: overrides.owner || 'ops-owner',
    channels: overrides.channels || ['email'],
    milestones: overrides.milestones || ['plan', 'stage', 'launch'],
    focus: PROGRAM.focus
  };
}
