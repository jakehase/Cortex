import { buildAdvocacyWorkbenchSnapshot, createAdvocacyWorkbenchRouteSummary } from '../service-advocacy-workbench.mjs';

export function createAdvocacyWorkbenchDashboardRoutes(basePath = '/advocacy-workbench') {
  const snapshot = buildAdvocacyWorkbenchSnapshot();
  return [
    { id: 'advocacy-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyWorkbenchRouteSummary(snapshot) },
    { id: 'advocacy-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

