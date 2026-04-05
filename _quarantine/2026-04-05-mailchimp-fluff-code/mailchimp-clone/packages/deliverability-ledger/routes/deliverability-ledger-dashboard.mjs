import { buildDeliverabilityLedgerSnapshot, createDeliverabilityLedgerRouteSummary } from '../service-deliverability-ledger.mjs';

export function createDeliverabilityLedgerDashboardRoutes(basePath = '/deliverability-ledger') {
  const snapshot = buildDeliverabilityLedgerSnapshot();
  return [
    { id: 'deliverability-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityLedgerRouteSummary(snapshot) },
    { id: 'deliverability-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

