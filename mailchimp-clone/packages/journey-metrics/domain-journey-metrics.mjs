const PROGRAM = {
  id: 'journey-metrics',
  name: 'Journey Metrics',
  focus: 'Journey Metrics coordinates journey, metrics programs with reusable playbooks, controls, and rollout telemetry.',
  themes: ["journey","metrics"],
  metrics: ["journey","metrics","coverage","latency"],
  lanes: ["plan","stage","launch","stabilize"]
};

export function createJourneyMetricsWorkspace(workspaceName = 'Expansion workspace') {
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
      id: 'journey-metrics-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: 'Journey Metrics' + ' keeps ' + lane + ' work visible for stakeholders.'
    }))
  };
}

export function summarizeJourneyMetrics(workspace = createJourneyMetricsWorkspace()) {
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

export function createJourneyMetricsNarratives(workspace = createJourneyMetricsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' plan',
    summary: 'Wave expansion narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}
