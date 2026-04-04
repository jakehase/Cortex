import { buildLoyaltyLedgerSnapshot, createLoyaltyLedgerRouteSummary } from '../service-loyalty-ledger.mjs';

export function createLoyaltyLedgerDashboardRoutes(basePath = '/loyalty-ledger') {
  const snapshot = buildLoyaltyLedgerSnapshot();
  return [
    { id: 'loyalty-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyLedgerRouteSummary(snapshot) },
    { id: 'loyalty-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

