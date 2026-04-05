import { buildActivationConsoleSnapshot, createActivationConsoleRouteSummary } from '../service-activation-console.mjs';

export function createActivationConsoleDashboardRoutes(basePath = '/activation-console') {
  const snapshot = buildActivationConsoleSnapshot();
  return [
    { id: 'activation-console.dashboard.overview', method: 'GET', path: basePath, summary: createActivationConsoleRouteSummary(snapshot) },
    { id: 'activation-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

