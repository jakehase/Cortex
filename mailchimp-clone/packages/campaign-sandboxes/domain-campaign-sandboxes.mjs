const PROGRAM = {
  id: "campaign-sandboxes",
  name: "Campaign Sandboxes",
  focus: "Campaign Sandboxes extends the real-repo expansion with preflight sandboxes, preview environments, and scenario rehearsal.",
  themes: ["campaign", "sandbox"],
  metrics: ["rehearsal", "preview", "risk", "confidence"],
  lanes: ["seed", "draft", "validate", "launch"]
};

export function createCampaignSandboxesWorkspace(workspaceName = 'Wave 6 workspace') {
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
      narrative: "Campaign Sandboxes" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "campaign-sandboxes" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Campaign Sandboxes" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeCampaignSandboxes(workspace = createCampaignSandboxesWorkspace()) {
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

export function createCampaignSandboxesNarratives(workspace = createCampaignSandboxesWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

