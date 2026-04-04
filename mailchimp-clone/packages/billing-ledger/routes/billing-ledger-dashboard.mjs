import { buildBillingLedgerSnapshot, createBillingLedgerRouteSummary } from '../service-billing-ledger.mjs';

export function createBillingLedgerDashboardRoutes(basePath = '/billing-ledger') {
  const snapshot = buildBillingLedgerSnapshot();
  return [
    { id: 'billing-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createBillingLedgerRouteSummary(snapshot) },
    { id: 'billing-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

