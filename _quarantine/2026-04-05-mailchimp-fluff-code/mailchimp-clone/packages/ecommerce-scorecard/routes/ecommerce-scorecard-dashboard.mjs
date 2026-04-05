import { buildEcommerceScorecardSnapshot, createEcommerceScorecardRouteSummary } from '../service-ecommerce-scorecard.mjs';

export function createEcommerceScorecardDashboardRoutes(basePath = '/ecommerce-scorecard') {
  const snapshot = buildEcommerceScorecardSnapshot();
  return [
    { id: 'ecommerce-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceScorecardRouteSummary(snapshot) },
    { id: 'ecommerce-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

