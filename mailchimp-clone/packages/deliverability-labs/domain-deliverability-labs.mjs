const PROGRAM = {
  id: 'deliverability-labs',
  name: 'Deliverability Labs',
  focus: 'Deliverability Labs extends the continuation with deliverability, labs planning, monitoring, and launch operations.',
  themes: ["deliverability","labs"],
  metrics: ["deliverability","labs","velocity","coverage"],
  lanes: ["brief","build","ship","review"]
};

export function createDeliverabilityLabsWorkspace(workspaceName = 'Continuation workspace') {
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: PROGRAM.metrics.map((metric, index) => ({
      id: metric,
      label: metric.replace(/-/g, ' '),
      currentValue: 18 + (index * 4),
      targetValue: 26 + (index * 6),
      posture: index % 2 === 0 ? 'healthy' : 'watch',
      narrative: 'Deliverability Labs tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: 'deliverability-labs-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: 'Deliverability Labs keeps ' + lane + ' milestones visible.'
    }))
  };
}

export function summarizeDeliverabilityLabs(workspace = createDeliverabilityLabsWorkspace()) {
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

export function createDeliverabilityLabsNarratives(workspace = createDeliverabilityLabsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Continuation narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}
