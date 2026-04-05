import { buildAnalyticsFoundrySnapshot, createAnalyticsFoundryRouteSummary } from '../service-analytics-foundry.mjs';

export function createAnalyticsFoundryDashboardRoutes(basePath = '/analytics-foundry') {
  const snapshot = buildAnalyticsFoundrySnapshot();
  return [
    { id: 'analytics-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsFoundryRouteSummary(snapshot) },
    { id: 'analytics-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

