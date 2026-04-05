import { buildInsightsVaultSnapshot, createInsightsVaultRouteSummary } from '../service-insights-vault.mjs';

export function createInsightsVaultDashboardRoutes(basePath = '/insights-vault') {
  const snapshot = buildInsightsVaultSnapshot();
  return [
    { id: 'insights-vault.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsVaultRouteSummary(snapshot) },
    { id: 'insights-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

