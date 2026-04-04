import { buildCreativeLedgerSnapshot, createCreativeLedgerRouteSummary } from '../service-creative-ledger.mjs';

export function createCreativeLedgerDashboardRoutes(basePath = '/creative-ledger') {
  const snapshot = buildCreativeLedgerSnapshot();
  return [
    { id: 'creative-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeLedgerRouteSummary(snapshot) },
    { id: 'creative-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

