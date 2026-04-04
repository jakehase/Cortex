import { buildAudienceLedgerSnapshot, createAudienceLedgerRouteSummary } from '../service-audience-ledger.mjs';

export function createAudienceLedgerDashboardRoutes(basePath = '/audience-ledger') {
  const snapshot = buildAudienceLedgerSnapshot();
  return [
    { id: 'audience-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceLedgerRouteSummary(snapshot) },
    { id: 'audience-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

