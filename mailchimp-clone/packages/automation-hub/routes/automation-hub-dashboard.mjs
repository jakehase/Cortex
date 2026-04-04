import { buildAutomationHubSnapshot, createAutomationHubRouteSummary } from '../service-automation-hub.mjs';

export function createAutomationHubDashboardRoutes(basePath = '/automation-hub') {
  const snapshot = buildAutomationHubSnapshot();
  return [
    { id: 'automation-hub.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationHubRouteSummary(snapshot) },
    { id: 'automation-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

