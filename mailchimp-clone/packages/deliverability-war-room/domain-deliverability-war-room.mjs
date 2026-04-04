const PROGRAM = {
  id: "deliverability-war-room",
  name: "Deliverability War Room",
  focus: "Deliverability War Room extends the real-repo expansion with deliverability incident coordination, sender triage, and follow-through.",
  themes: ["deliverability", "war-room"],
  metrics: ["alerts", "senders", "remediation", "recovery"],
  lanes: ["detect", "contain", "repair", "report"]
};

export function createDeliverabilityWarRoomWorkspace(workspaceName = 'Wave 6 workspace') {
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
      narrative: "Deliverability War Room" + ' tracks ' + metric + ' for ' + workspaceName + '.'
    })),
    programs: PROGRAM.lanes.map((lane, index) => ({
      id: "deliverability-war-room" + '-program-' + (index + 1),
      lane,
      owner: lane + '-owner',
      status: index === 0 ? 'active' : index === 1 ? 'planned' : index === 2 ? 'review' : 'monitoring',
      narrative: "Deliverability War Room" + ' keeps ' + lane + ' execution visible.'
    }))
  };
}

export function summarizeDeliverabilityWarRoom(workspace = createDeliverabilityWarRoomWorkspace()) {
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

export function createDeliverabilityWarRoomNarratives(workspace = createDeliverabilityWarRoomWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.name + ' ' + program.lane + ' sequence',
    summary: 'Wave 6 narrative ' + (index + 1) + ' for ' + workspace.workspaceName + '.',
    dependencies: workspace.scorecards.slice(0, 2).map((card) => card.id)
  }));
}

