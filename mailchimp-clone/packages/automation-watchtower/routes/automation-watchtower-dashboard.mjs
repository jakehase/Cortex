import { buildAutomationWatchtowerSnapshot, createAutomationWatchtowerRouteSummary } from '../service-automation-watchtower.mjs';

export function createAutomationWatchtowerDashboardRoutes(basePath = '/automation-watchtower') {
  const snapshot = buildAutomationWatchtowerSnapshot();
  return [
    { id: 'automation-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationWatchtowerRouteSummary(snapshot) },
    { id: 'automation-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

