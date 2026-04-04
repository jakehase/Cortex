import { buildIntegrationsLedgerSnapshot, createIntegrationsLedgerRouteSummary } from '../service-integrations-ledger.mjs';

export function createIntegrationsLedgerDashboardRoutes(basePath = '/integrations-ledger') {
  const snapshot = buildIntegrationsLedgerSnapshot();
  return [
    { id: 'integrations-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsLedgerRouteSummary(snapshot) },
    { id: 'integrations-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

