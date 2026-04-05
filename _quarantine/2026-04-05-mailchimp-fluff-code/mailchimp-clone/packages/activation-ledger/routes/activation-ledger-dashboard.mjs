import { buildActivationLedgerSnapshot, createActivationLedgerRouteSummary } from '../service-activation-ledger.mjs';

export function createActivationLedgerDashboardRoutes(basePath = '/activation-ledger') {
  const snapshot = buildActivationLedgerSnapshot();
  return [
    { id: 'activation-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createActivationLedgerRouteSummary(snapshot) },
    { id: 'activation-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

