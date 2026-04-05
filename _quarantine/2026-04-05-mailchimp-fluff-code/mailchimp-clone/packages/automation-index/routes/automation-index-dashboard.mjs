import { buildAutomationIndexSnapshot, createAutomationIndexRouteSummary } from '../service-automation-index.mjs';

export function createAutomationIndexDashboardRoutes(basePath = '/automation-index') {
  const snapshot = buildAutomationIndexSnapshot();
  return [
    { id: 'automation-index.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationIndexRouteSummary(snapshot) },
    { id: 'automation-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

