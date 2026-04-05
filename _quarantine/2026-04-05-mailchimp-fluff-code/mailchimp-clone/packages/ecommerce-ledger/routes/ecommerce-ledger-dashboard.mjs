import { buildEcommerceLedgerSnapshot, createEcommerceLedgerRouteSummary } from '../service-ecommerce-ledger.mjs';

export function createEcommerceLedgerDashboardRoutes(basePath = '/ecommerce-ledger') {
  const snapshot = buildEcommerceLedgerSnapshot();
  return [
    { id: 'ecommerce-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceLedgerRouteSummary(snapshot) },
    { id: 'ecommerce-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

