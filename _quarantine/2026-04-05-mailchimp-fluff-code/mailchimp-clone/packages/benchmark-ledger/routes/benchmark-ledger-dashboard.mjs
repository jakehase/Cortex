import { buildBenchmarkLedgerSnapshot, createBenchmarkLedgerRouteSummary } from '../service-benchmark-ledger.mjs';

export function createBenchmarkLedgerDashboardRoutes(basePath = '/benchmark-ledger') {
  const snapshot = buildBenchmarkLedgerSnapshot();
  return [
    { id: 'benchmark-ledger.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkLedgerRouteSummary(snapshot) },
    { id: 'benchmark-ledger.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-ledger.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

