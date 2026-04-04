import { buildCollaborationLedgerSnapshot, createCollaborationLedgerRouteSummary } from '../service-collaboration-ledger.mjs';

export function createCollaborationLedgerDashboardRoutes(basePath = '/collaboration-ledger') {
  const snapshot = buildCollaborationLedgerSnapshot();
  return [
    { id: 'collaboration-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createCollaborationLedgerRouteSummary(snapshot) },
    { id: 'collaboration-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'collaboration-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

