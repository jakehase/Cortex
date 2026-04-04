import { buildAdvocacyLedgerSnapshot, createAdvocacyLedgerRouteSummary } from '../service-advocacy-ledger.mjs';

export function createAdvocacyLedgerDashboardRoutes(basePath = '/advocacy-ledger') {
  const snapshot = buildAdvocacyLedgerSnapshot();
  return [
    { id: 'advocacy-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyLedgerRouteSummary(snapshot) },
    { id: 'advocacy-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

