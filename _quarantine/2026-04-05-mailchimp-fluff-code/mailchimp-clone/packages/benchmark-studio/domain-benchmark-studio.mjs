const PROGRAM = {
  id: "benchmark-studio",
  name: "Benchmark Studio",
  focus: "Benchmark Studio extends the real-repo expansion with benchmark packs, peer comparisons, and workspace score ranges.",
  themes: ["benchmark", "studio"],
  metrics: ["cohort", "lift", "variance", "coverage"],
  lanes: ["collect", "compare", "review", "publish"]
};

export function createBenchmarkStudioWorkspace(workspaceName = 'Wave 6 workspace') {
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
      narrative: "Benchmark Studio" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "benchmark-studio" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Benchmark Studio" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeBenchmarkStudio(workspace = createBenchmarkStudioWorkspace()) {
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

export function createBenchmarkStudioNarratives(workspace = createBenchmarkStudioWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

