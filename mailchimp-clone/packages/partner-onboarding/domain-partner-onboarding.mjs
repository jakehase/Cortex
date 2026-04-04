const PROGRAM = {
  id: 'partner-onboarding',
  name: 'Partner Onboarding',
  focus: 'Partner Onboarding extends the continuation with partner, onboarding planning, monitoring, and launch operations.',
  themes: ["partner","onboarding"],
  metrics: ["partner","onboarding","velocity","coverage"],
  lanes: ["brief","build","ship","review"]
};

export function createPartnerOnboardingWorkspace(workspaceName = 'Continuation workspace') {
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
      narrative: 'Partner Onboarding tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: 'partner-onboarding-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: 'Partner Onboarding keeps ' + lane + ' milestones visible.'
    }))
  };
}

export function summarizePartnerOnboarding(workspace = createPartnerOnboardingWorkspace()) {
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

export function createPartnerOnboardingNarratives(workspace = createPartnerOnboardingWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Continuation narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}
