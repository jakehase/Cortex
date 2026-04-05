import { buildAutomationConsoleSnapshot, createAutomationConsoleRouteSummary } from '../service-automation-console.mjs';

export function createAutomationConsoleDashboardRoutes(basePath = '/automation-console') {
  const snapshot = buildAutomationConsoleSnapshot();
  return [
    { id: 'automation-console.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationConsoleRouteSummary(snapshot) },
    { id: 'automation-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

