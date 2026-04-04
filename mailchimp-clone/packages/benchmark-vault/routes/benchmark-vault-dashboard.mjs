import { buildBenchmarkVaultSnapshot, createBenchmarkVaultRouteSummary } from '../service-benchmark-vault.mjs';

export function createBenchmarkVaultDashboardRoutes(basePath = '/benchmark-vault') {
  const snapshot = buildBenchmarkVaultSnapshot();
  return [
    { id: 'benchmark-vault.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkVaultRouteSummary(snapshot) },
    { id: 'benchmark-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

