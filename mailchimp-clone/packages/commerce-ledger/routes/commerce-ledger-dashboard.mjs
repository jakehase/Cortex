import { buildCommerceLedgerSnapshot, createCommerceLedgerRouteSummary } from '../service-commerce-ledger.mjs';

export function createCommerceLedgerDashboardRoutes(basePath = '/commerce-ledger') {
  const snapshot = buildCommerceLedgerSnapshot();
  return [
    { id: 'commerce-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceLedgerRouteSummary(snapshot) },
    { id: 'commerce-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

