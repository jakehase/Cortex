const MODULE = {
  "id": "analytics-sentinel",
  "ordinal": 76,
  "domain": "analytics",
  "surfaceId": "sentinel",
  "surfaceTitle": "Sentinel",
  "routeSegment": "sentinel",
  "title": "Analytics Sentinel",
  "focus": "Analytics Sentinel covers portfolio analytics, operator scorecards, and query-driven reviews through alerts, anomaly watch, and guardrails.",
  "descriptor": "portfolio analytics, operator scorecards, and query-driven reviews",
  "groupId": "revenue",
  "groupTitle": "Revenue, billing, and commerce operations",
  "groupDescription": "Revenue-centric operations that connect launches to billing posture, commerce readiness, and commercial recovery motions.",
  "metrics": [
    "gmv",
    "margin",
    "revenue",
    "recovery",
    "benchmark",
    "forecast"
  ],
  "lanes": [
    "baseline",
    "model",
    "reconcile",
    "approve",
    "share",
    "improve"
  ],
  "controls": [
    "finance-approval",
    "forecast-gap",
    "margin-guardrail",
    "merchant-review",
    "closeout-check",
    "variance-brief"
  ],
  "evidenceTypes": [
    "forecast-pack",
    "variance-deck",
    "billing-log",
    "merchant-summary",
    "revenue-snapshot",
    "close-report"
  ],
  "signals": [
    "gmv",
    "margin",
    "variance",
    "pacing",
    "refund",
    "collection"
  ],
  "persona": "revenue operations manager",
  "themes": [
    "analytics",
    "sentinel",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "analytics",
    "sentinel",
    "revenue",
    "analytics-sentinel-wave-seven"
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

export function createAnalyticsSentinelWorkspace(workspaceName = 'Scale Wave Seven workspace') {
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

export function summarizeAnalyticsSentinelWorkspace(workspace = createAnalyticsSentinelWorkspace()) {
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

export function createAnalyticsSentinelNarratives(workspace = createAnalyticsSentinelWorkspace()) {
  return workspace.programs.map((program, index) => ({
    id: program.id + '-narrative',
    headline: workspace.title + ' ' + program.lane + ' narrative',
    summary: 'Narrative ' + (index + 1) + ' explains how ' + workspace.focus.toLowerCase(),
    dependencies: workspace.scorecards.slice(0, 3).map((card) => card.metric),
    controls: workspace.themes.slice(0, 3)
  }));
}

export function createAnalyticsSentinelCoverageGrid(workspace = createAnalyticsSentinelWorkspace()) {
  return workspace.scorecards.map((card, index) => ({
    id: workspace.id + '-coverage-' + (index + 1),
    label: card.label,
    owner: workspace.persona,
    region: index % 2 === 0 ? 'core' : 'extended',
    note: workspace.title + ' exposes ' + card.label + ' coverage to the scale campaign.'
  }));
}

