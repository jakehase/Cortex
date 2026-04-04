const PROGRAM = {
  id: "creative-brief-builder",
  name: "Creative Brief Builder",
  focus: "Creative Brief Builder extends the real-repo expansion with creative brief intake, approvals, and asset-ready summaries.",
  themes: ["creative", "brief"],
  metrics: ["briefs", "owners", "turnaround", "clarity"],
  lanes: ["intake", "draft", "align", "handoff"]
};

export function createCreativeBriefBuilderWorkspace(workspaceName = 'Wave 6 workspace') {
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
      narrative: "Creative Brief Builder" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "creative-brief-builder" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Creative Brief Builder" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeCreativeBriefBuilder(workspace = createCreativeBriefBuilderWorkspace()) {
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

export function createCreativeBriefBuilderNarratives(workspace = createCreativeBriefBuilderWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

