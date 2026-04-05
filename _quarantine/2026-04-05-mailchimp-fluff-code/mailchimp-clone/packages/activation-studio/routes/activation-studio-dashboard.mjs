import { buildActivationStudioSnapshot, createActivationStudioRouteSummary } from '../service-activation-studio.mjs';

export function createActivationStudioDashboardRoutes(basePath = '/activation-studio') {
  const snapshot = buildActivationStudioSnapshot();
  return [
    { id: 'activation-studio.dashboard.overview', method: 'GET', path: basePath, summary: createActivationStudioRouteSummary(snapshot) },
    { id: 'activation-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

