import { buildAutomationLedgerSnapshot, createAutomationLedgerRouteSummary } from '../service-automation-ledger.mjs';

export function createAutomationLedgerDashboardRoutes(basePath = '/automation-ledger') {
  const snapshot = buildAutomationLedgerSnapshot();
  return [
    { id: 'automation-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationLedgerRouteSummary(snapshot) },
    { id: 'automation-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

