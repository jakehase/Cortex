import { buildActivationIndexSnapshot, createActivationIndexRouteSummary } from '../service-activation-index.mjs';

export function createActivationIndexDashboardRoutes(basePath = '/activation-index') {
  const snapshot = buildActivationIndexSnapshot();
  return [
    { id: 'activation-index.dashboard.overview', method: 'GET', path: basePath, summary: createActivationIndexRouteSummary(snapshot) },
    { id: 'activation-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

