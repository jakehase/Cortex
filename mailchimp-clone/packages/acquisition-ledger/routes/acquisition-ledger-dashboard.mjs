import { buildAcquisitionLedgerSnapshot, createAcquisitionLedgerRouteSummary } from '../service-acquisition-ledger.mjs';

export function createAcquisitionLedgerDashboardRoutes(basePath = '/acquisition-ledger') {
  const snapshot = buildAcquisitionLedgerSnapshot();
  return [
    { id: 'acquisition-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionLedgerRouteSummary(snapshot) },
    { id: 'acquisition-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

