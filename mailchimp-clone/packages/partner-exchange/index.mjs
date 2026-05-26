const PROGRAM = Object.freeze({
  id: "partner-exchange",
  name: "Partner Exchange",
  focus: "partner listings, app certification, and marketplace handoff readiness",
  metrics: Object.freeze([
  "listings",
  "certifications",
  "handoffs"
]),
  items: Object.freeze([
  "Listing intake",
  "Certification checklist",
  "Partner success handoff"
])
});

export function createPartnerExchangeWorkspace(workspaceName = 'Demo workspace') {
  const scorecards = PROGRAM.metrics.map((metric, index) => ({
    id: metric.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: metric,
    value: (index + 1) * 11,
    posture: index === 1 ? 'watch' : 'healthy'
  }));
  const workstreams = PROGRAM.items.map((item, index) => ({
    id: PROGRAM.id + '-ws-' + (index + 1),
    title: item,
    status: index === 0 ? 'active' : index === 1 ? 'planned' : 'monitoring'
  }));
  return {
    ...PROGRAM,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scorecards,
    workstreams,
    programs: workstreams
  };
}

export function summarizePartnerExchange(workspace = createPartnerExchangeWorkspace()) {
  const activeCount = workspace.workstreams.filter((entry) => entry.status === 'active').length;
  return {
    id: workspace.id,
    name: workspace.name,
    focus: workspace.focus,
    workspaceName: workspace.workspaceName,
    activeWorkstreams: activeCount,
    activePrograms: activeCount,
    metricCount: workspace.scorecards.length,
    watchItems: workspace.scorecards.filter((entry) => entry.posture === 'watch').map((entry) => entry.id)
  };
}

export function createPartnerExchangeDashboardRoutes(basePath = '/partner-exchange') {
  const workspace = createPartnerExchangeWorkspace();
  const summary = summarizePartnerExchange(workspace);
  return [
    { id: PROGRAM.id + '.home', method: 'GET', path: basePath, summary },
    { id: PROGRAM.id + '.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: PROGRAM.id + '.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
