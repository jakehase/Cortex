import { buildInsightsFoundrySnapshot, createInsightsFoundryRouteSummary } from '../service-insights-foundry.mjs';

export function createInsightsFoundryDashboardRoutes(basePath = '/insights-foundry') {
  const snapshot = buildInsightsFoundrySnapshot();
  return [
    { id: 'insights-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsFoundryRouteSummary(snapshot) },
    { id: 'insights-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

