import { buildExperimentationLedgerSnapshot, createExperimentationLedgerRouteSummary } from '../service-experimentation-ledger.mjs';

export function createExperimentationLedgerDashboardRoutes(basePath = '/experimentation-ledger') {
  const snapshot = buildExperimentationLedgerSnapshot();
  return [
    { id: 'experimentation-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationLedgerRouteSummary(snapshot) },
    { id: 'experimentation-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

