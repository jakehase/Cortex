import { buildAutomationWorkbenchSnapshot, createAutomationWorkbenchRouteSummary } from '../service-automation-workbench.mjs';

export function createAutomationWorkbenchDashboardRoutes(basePath = '/automation-workbench') {
  const snapshot = buildAutomationWorkbenchSnapshot();
  return [
    { id: 'automation-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationWorkbenchRouteSummary(snapshot) },
    { id: 'automation-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

