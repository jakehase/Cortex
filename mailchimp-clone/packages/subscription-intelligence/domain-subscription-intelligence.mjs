const PROGRAM = {
  id: "subscription-intelligence",
  name: "Subscription Intelligence",
  focus: "Subscription Intelligence extends the real-repo expansion with subscription cohorts, plan migration signals, and expansion posture.",
  themes: ["subscription", "intelligence"],
  metrics: ["plans", "churn", "expansion", "signals"],
  lanes: ["observe", "score", "nurture", "review"]
};

export function createSubscriptionIntelligenceWorkspace(workspaceName = 'Wave 6 workspace') {
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: PROGRAM.metrics.map((metric, index) => ({
      id: metric,
      label: metric.replace(/-/g, ' '),
      currentValue: 22 + (index * 5),
      targetValue: 34 + (index * 7),
      posture: index % 2 === 0 ? 'healthy' : 'watch',
      narrative: "Subscription Intelligence" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "subscription-intelligence" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Subscription Intelligence" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeSubscriptionIntelligence(workspace = createSubscriptionIntelligenceWorkspace()) {
  return {
    id: workspace.id,
    name: workspace.name,
    focus: workspace.focus,
    workspaceName: workspace.workspaceName,
    metricCount: workspace.scorecards.length,
    activePrograms: workspace.programs.filter((entry) => entry.status === 'active').length,
    watchMetrics: workspace.scorecards.filter((entry) => entry.posture === 'watch').map((entry) => entry.id)
  };
}

export function createSubscriptionIntelligenceNarratives(workspace = createSubscriptionIntelligenceWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

