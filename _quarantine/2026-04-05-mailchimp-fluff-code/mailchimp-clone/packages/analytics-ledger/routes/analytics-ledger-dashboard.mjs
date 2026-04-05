import { buildAnalyticsLedgerSnapshot, createAnalyticsLedgerRouteSummary } from '../service-analytics-ledger.mjs';

export function createAnalyticsLedgerDashboardRoutes(basePath = '/analytics-ledger') {
  const snapshot = buildAnalyticsLedgerSnapshot();
  return [
    { id: 'analytics-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsLedgerRouteSummary(snapshot) },
    { id: 'analytics-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

