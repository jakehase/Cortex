import { buildAutomationNavigatorSnapshot, createAutomationNavigatorRouteSummary } from '../service-automation-navigator.mjs';

export function createAutomationNavigatorDashboardRoutes(basePath = '/automation-navigator') {
  const snapshot = buildAutomationNavigatorSnapshot();
  return [
    { id: 'automation-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationNavigatorRouteSummary(snapshot) },
    { id: 'automation-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

