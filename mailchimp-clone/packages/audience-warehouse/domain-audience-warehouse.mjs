const PROGRAM = {
  id: 'audience-warehouse',
  name: 'Audience Warehouse',
  focus: 'Audience Warehouse extends the continuation with audience, warehouse planning, monitoring, and launch operations.',
  themes: ["audience","warehouse"],
  metrics: ["audience","warehouse","velocity","coverage"],
  lanes: ["brief","build","ship","review"]
};

export function createAudienceWarehouseWorkspace(workspaceName = 'Continuation workspace') {
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
      narrative: 'Audience Warehouse tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: 'audience-warehouse-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: 'Audience Warehouse keeps ' + lane + ' milestones visible.'
    }))
  };
}

export function summarizeAudienceWarehouse(workspace = createAudienceWarehouseWorkspace()) {
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

export function createAudienceWarehouseNarratives(workspace = createAudienceWarehouseWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Continuation narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}
