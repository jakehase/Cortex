import { buildActivationWorkbenchSnapshot, createActivationWorkbenchRouteSummary } from '../service-activation-workbench.mjs';

export function createActivationWorkbenchDashboardRoutes(basePath = '/activation-workbench') {
  const snapshot = buildActivationWorkbenchSnapshot();
  return [
    { id: 'activation-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createActivationWorkbenchRouteSummary(snapshot) },
    { id: 'activation-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

