import { buildAttributionLedgerSnapshot, createAttributionLedgerRouteSummary } from '../service-attribution-ledger.mjs';

export function createAttributionLedgerDashboardRoutes(basePath = '/attribution-ledger') {
  const snapshot = buildAttributionLedgerSnapshot();
  return [
    { id: 'attribution-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionLedgerRouteSummary(snapshot) },
    { id: 'attribution-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

