const PROGRAM = {
  id: "template-approvals",
  name: "Template Approvals",
  focus: "Template Approvals extends the real-repo expansion with template review workflows, approvals, and launch readiness.",
  themes: ["template", "approval"],
  metrics: ["templates", "reviews", "turnaround", "coverage"],
  lanes: ["draft", "review", "approve", "release"]
};

export function createTemplateApprovalsWorkspace(workspaceName = 'Wave 6 workspace') {
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
      narrative: "Template Approvals" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "template-approvals" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Template Approvals" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeTemplateApprovals(workspace = createTemplateApprovalsWorkspace()) {
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

export function createTemplateApprovalsNarratives(workspace = createTemplateApprovalsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

export function createTemplateApprovalLoadboard(workspace = createTemplateApprovalsWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: `${program.id}-loadboard`,
    lane: program.lane,
    reviewer: program.owner,
    templatesWaiting: 3 + index,
    targetSlaHours: 4 + (index * 2),
    risk: index === 0 ? 'normal' : index === 1 ? 'watch' : index === 2 ? 'priority' : 'archive',
    notes: `${workspace.name} keeps ${program.lane} approvals flowing with explicit ownership and SLA tracking.`
  }));
}

export function summarizeApprovalCoverage(workspace = createTemplateApprovalsWorkspace()) {
  const loadboard = createTemplateApprovalLoadboard(workspace);
  return {
    workspaceId: workspace.id,
    reviewers: loadboard.map((entry) => entry.reviewer),
    totalTemplatesWaiting: loadboard.reduce((sum, entry) => sum + entry.templatesWaiting, 0),
    priorityLanes: loadboard.filter((entry) => entry.risk === 'priority').map((entry) => entry.lane),
    averageSlaHours: Number((loadboard.reduce((sum, entry) => sum + entry.targetSlaHours, 0) / loadboard.length).toFixed(2))
  };
}
