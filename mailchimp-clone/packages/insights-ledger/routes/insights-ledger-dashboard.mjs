import { buildInsightsLedgerSnapshot, createInsightsLedgerRouteSummary } from '../service-insights-ledger.mjs';

export function createInsightsLedgerDashboardRoutes(basePath = '/insights-ledger') {
  const snapshot = buildInsightsLedgerSnapshot();
  return [
    { id: 'insights-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsLedgerRouteSummary(snapshot) },
    { id: 'insights-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

