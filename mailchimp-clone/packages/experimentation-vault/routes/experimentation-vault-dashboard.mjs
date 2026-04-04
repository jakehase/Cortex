import { buildExperimentationVaultSnapshot, createExperimentationVaultRouteSummary } from '../service-experimentation-vault.mjs';

export function createExperimentationVaultDashboardRoutes(basePath = '/experimentation-vault') {
  const snapshot = buildExperimentationVaultSnapshot();
  return [
    { id: 'experimentation-vault.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationVaultRouteSummary(snapshot) },
    { id: 'experimentation-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

