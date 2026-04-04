const PROGRAM = {
  id: 'billing-analytics',
  name: 'Billing Analytics',
  focus: 'Billing Analytics coordinates billing, analytics programs with reusable playbooks, controls, and rollout telemetry.',
  themes: ["billing","analytics"],
  metrics: ["billing","analytics","coverage","latency"],
  lanes: ["plan","stage","launch","stabilize"]
};

export function createBillingAnalyticsWorkspace(workspaceName = 'Expansion workspace') {
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: PROGRAM.metrics.map((metric, index) => ({
      id: metric,
      label: metric.replace(/-/g, ' '),
      currentValue: 12 + (index * 5),
      targetValue: 20 + (index * 6),
      posture: index % 2 === 0 ? 'healthy' : 'watch',
      narrative: 'Metric ' + metric + ' is tracked for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: 'billing-analytics-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: 'Billing Analytics' + ' keeps ' + lane + ' work visible for stakeholders.'
    }))
  };
}

export function summarizeBillingAnalytics(workspace = createBillingAnalyticsWorkspace()) {
  return {
    id: workspace.id,
    name: workspace.name,
    focus: workspace.focus,
    workspaceName: workspace.workspaceName,
    metricCount: workspace.scorecards.length,
    activePrograms: workspace.programs.filter((entry) => entry.status === 'active').length,
    watchMetrics: workspace.scorecards.filter((entry) => entry.posture === 'watch').map((entry) => entry.id),
    themes: workspace.themes
  };
}

export function createBillingAnalyticsNarratives(workspace = createBillingAnalyticsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' plan',
    summary: 'Wave expansion narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}
