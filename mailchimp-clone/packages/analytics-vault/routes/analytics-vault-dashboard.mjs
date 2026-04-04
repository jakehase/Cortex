import { buildAnalyticsVaultSnapshot, createAnalyticsVaultRouteSummary } from '../service-analytics-vault.mjs';

export function createAnalyticsVaultDashboardRoutes(basePath = '/analytics-vault') {
  const snapshot = buildAnalyticsVaultSnapshot();
  return [
    { id: 'analytics-vault.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsVaultRouteSummary(snapshot) },
    { id: 'analytics-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

