import { buildDataLedgerSnapshot, createDataLedgerRouteSummary } from '../service-data-ledger.mjs';

export function createDataLedgerDashboardRoutes(basePath = '/data-ledger') {
  const snapshot = buildDataLedgerSnapshot();
  return [
    { id: 'data-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createDataLedgerRouteSummary(snapshot) },
    { id: 'data-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

