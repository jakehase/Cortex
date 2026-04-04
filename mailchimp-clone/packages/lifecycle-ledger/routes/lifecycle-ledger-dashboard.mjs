import { buildLifecycleLedgerSnapshot, createLifecycleLedgerRouteSummary } from '../service-lifecycle-ledger.mjs';

export function createLifecycleLedgerDashboardRoutes(basePath = '/lifecycle-ledger') {
  const snapshot = buildLifecycleLedgerSnapshot();
  return [
    { id: 'lifecycle-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleLedgerRouteSummary(snapshot) },
    { id: 'lifecycle-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

