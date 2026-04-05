import { buildAutomationGridSnapshot, createAutomationGridRouteSummary } from '../service-automation-grid.mjs';

export function createAutomationGridDashboardRoutes(basePath = '/automation-grid') {
  const snapshot = buildAutomationGridSnapshot();
  return [
    { id: 'automation-grid.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationGridRouteSummary(snapshot) },
    { id: 'automation-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

