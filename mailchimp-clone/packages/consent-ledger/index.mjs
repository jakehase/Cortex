const PROGRAM = Object.freeze({
  id: "consent-ledger",
  name: "Consent Ledger",
  focus: "auditable consent history, subscription source tracking, and compliance exports",
  metrics: Object.freeze([
  "consent events",
  "source systems",
  "export jobs"
]),
  items: Object.freeze([
  "Consent event stream",
  "Source attribution map",
  "Compliance export queue"
])
});

export function createConsentLedgerWorkspace(workspaceName = 'Demo workspace') {
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

export function summarizeConsentLedger(workspace = createConsentLedgerWorkspace()) {
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

export function createConsentLedgerDashboardRoutes(basePath = '/consent-ledger') {
  const workspace = createConsentLedgerWorkspace();
  const summary = summarizeConsentLedger(workspace);
  return [
    { id: PROGRAM.id + '.home', method: 'GET', path: basePath, summary },
    { id: PROGRAM.id + '.scorecards', method: 'GET', path: basePath + '/scorecards', cards: workspace.scorecards },
    { id: PROGRAM.id + '.workstreams', method: 'GET', path: basePath + '/workstreams', workstreams: workspace.workstreams }
  ];
}
