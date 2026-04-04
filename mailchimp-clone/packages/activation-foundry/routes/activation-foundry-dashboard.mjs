import { buildActivationFoundrySnapshot, createActivationFoundryRouteSummary } from '../service-activation-foundry.mjs';

export function createActivationFoundryDashboardRoutes(basePath = '/activation-foundry') {
  const snapshot = buildActivationFoundrySnapshot();
  return [
    { id: 'activation-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createActivationFoundryRouteSummary(snapshot) },
    { id: 'activation-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

