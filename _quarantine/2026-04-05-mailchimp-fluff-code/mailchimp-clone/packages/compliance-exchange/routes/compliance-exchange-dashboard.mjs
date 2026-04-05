import { buildComplianceExchangeSnapshot, createComplianceExchangeRouteSummary } from '../service-compliance-exchange.mjs';

export function createComplianceExchangeDashboardRoutes(basePath = '/compliance-exchange') {
  const snapshot = buildComplianceExchangeSnapshot();
  return [
    { id: 'compliance-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceExchangeRouteSummary(snapshot) },
    { id: 'compliance-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

