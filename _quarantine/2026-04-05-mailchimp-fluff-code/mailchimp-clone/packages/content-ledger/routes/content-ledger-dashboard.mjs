import { buildContentLedgerSnapshot, createContentLedgerRouteSummary } from '../service-content-ledger.mjs';

export function createContentLedgerDashboardRoutes(basePath = '/content-ledger') {
  const snapshot = buildContentLedgerSnapshot();
  return [
    { id: 'content-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createContentLedgerRouteSummary(snapshot) },
    { id: 'content-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

