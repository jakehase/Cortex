const MODULE = {
  "id": "experimentation-cockpit",
  "ordinal": 421,
  "domain": "experimentation",
  "surfaceId": "cockpit",
  "surfaceTitle": "Cockpit",
  "routeSegment": "cockpit",
  "title": "Experimentation Cockpit",
  "focus": "Experimentation Cockpit covers test planning, variant analysis, and decision velocity through operator controls and active monitoring.",
  "descriptor": "test planning, variant analysis, and decision velocity",
  "groupId": "intelligence",
  "groupTitle": "Data, experimentation, and segmentation intelligence",
  "groupDescription": "Analytical workspaces that connect data readiness, experimentation posture, segmentation depth, and attribution signals.",
  "metrics": [
    "freshness",
    "coverage",
    "confidence",
    "throughput",
    "lineage",
    "lift"
  ],
  "lanes": [
    "collect",
    "score",
    "verify",
    "activate",
    "compare",
    "publish"
  ],
  "controls": [
    "lineage-proof",
    "quality-threshold",
    "segment-review",
    "integration-watch",
    "publish-approval",
    "lift-audit"
  ],
  "evidenceTypes": [
    "data-contract",
    "segment-card",
    "experiment-summary",
    "lineage-map",
    "publication-brief",
    "insight-review"
  ],
  "signals": [
    "freshness",
    "lift",
    "match-rate",
    "coverage",
    "confidence",
    "latency"
  ],
  "persona": "analytics program lead",
  "themes": [
    "experimentation",
    "cockpit",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "experimentation",
    "cockpit",
    "intelligence",
    "experimentation-cockpit-wave-seven"
  ]
};

function metricCard(metric, index, workspaceName) {
  return {
    id: MODULE.id + '-metric-' + (index + 1),
    metric,
    label: metric.replace(/-/g, ' '),
    owner: MODULE.persona,
    currentValue: 42 + (index * 7) + MODULE.ordinal,
    targetValue: 58 + (index * 9) + MODULE.ordinal,
    drift: index % 2 === 0 ? 'stable' : 'watch',
    narrative: MODULE.title + ' tracks ' + metric + ' for ' + workspaceName + '.'
  };
}

function laneRecord(lane, index) {
  return {
    id: MODULE.id + '-lane-' + (index + 1),
    lane,
    owner: lane + '-owner',
    status: index === 0 ? 'active' : index === 1 ? 'ready' : index === 2 ? 'review' : index === 3 ? 'monitoring' : index === 4 ? 'share' : 'queued',
    promise: MODULE.title + ' keeps the ' + lane + ' motion visible across the ' + MODULE.groupTitle.toLowerCase() + ' surface.'
  };
}

function milestoneRecord(lane, index) {
  return {
    id: MODULE.id + '-milestone-' + (index + 1),
    title: MODULE.surfaceTitle + ' ' + lane + ' checkpoint',
    dueWindow: 'W' + (index + 1),
    confidence: index % 2 === 0 ? 'high' : 'medium',
    detail: 'Checkpoint ' + (index + 1) + ' translates ' + MODULE.descriptor + ' into a concrete program step.'
  };
}

export function createExperimentationCockpitWorkspace(workspaceName = 'Scale Wave Seven workspace') {
  return {
    ...MODULE,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards: MODULE.metrics.map((metric, index) => metricCard(metric, index, workspaceName)),
    programs: MODULE.lanes.map((lane, index) => laneRecord(lane, index)),
    milestones: MODULE.lanes.map((lane, index) => milestoneRecord(lane, index)),
    evidenceBurndown: MODULE.evidenceTypes.map((artifact, index) => ({
      id: MODULE.id + '-evidence-' + (index + 1),
      artifact,
      readiness: index % 2 === 0 ? 'ready' : 'draft',
      owner: MODULE.persona,
      note: MODULE.title + ' maintains ' + artifact + ' evidence for the workspace.'
    })),
    signalDeck: MODULE.signals.map((signal, index) => ({
      id: MODULE.id + '-signal-' + (index + 1),
      signal,
      direction: index % 2 === 0 ? 'up' : 'watch',
      summary: MODULE.groupTitle + ' uses ' + signal + ' to describe operating posture.'
    }))
  };
}

export function summarizeExperimentationCockpitWorkspace(workspace = createExperimentationCockpitWorkspace()) {
  return {
    id: workspace.id,
    title: workspace.title,
    groupTitle: workspace.groupTitle,
    workspaceName: workspace.workspaceName,
    metricCount: workspace.scorecards.length,
    activePrograms: workspace.programs.filter((entry) => entry.status === 'active').length,
    evidenceCount: workspace.evidenceBurndown.length,
    watchSignals: workspace.signalDeck.filter((entry) => entry.direction === 'watch').map((entry) => entry.signal)
  };
}

export function createExperimentationCockpitNarratives(workspace = createExperimentationCockpitWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.title + ' ' + program.lane + ' narrative',
    summary: 'Narrative ' + (index + 1) + ' explains how ' + workspace.focus.toLowerCase(),
    dependencies: workspace.scorecards.slice(0, 3).map((card) => card.metric),
    controls: workspace.themes.slice(0, 3)
  }));
}

export function createExperimentationCockpitCoverageGrid(workspace = createExperimentationCockpitWorkspace()) {
  return workspace.scorecards.map((card, index) => ({
    id: workspace.id + '-coverage-' + (index + 1),
    label: card.label,
    owner: workspace.persona,
    region: index % 2 === 0 ? 'core' : 'extended',
    note: workspace.title + ' exposes ' + card.label + ' coverage to the scale campaign.'
  }));
}

