import { buildCustomerLedgerSnapshot, createCustomerLedgerRouteSummary } from '../service-customer-ledger.mjs';

export function createCustomerLedgerDashboardRoutes(basePath = '/customer-ledger') {
  const snapshot = buildCustomerLedgerSnapshot();
  return [
    { id: 'customer-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerLedgerRouteSummary(snapshot) },
    { id: 'customer-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

