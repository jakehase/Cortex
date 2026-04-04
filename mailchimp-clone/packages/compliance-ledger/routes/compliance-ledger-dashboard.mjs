import { buildComplianceLedgerSnapshot, createComplianceLedgerRouteSummary } from '../service-compliance-ledger.mjs';

export function createComplianceLedgerDashboardRoutes(basePath = '/compliance-ledger') {
  const snapshot = buildComplianceLedgerSnapshot();
  return [
    { id: 'compliance-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceLedgerRouteSummary(snapshot) },
    { id: 'compliance-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

