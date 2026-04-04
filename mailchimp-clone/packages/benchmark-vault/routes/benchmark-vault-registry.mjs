import { buildBenchmarkVaultSnapshot, createBenchmarkVaultRouteSummary } from '../service-benchmark-vault.mjs';

export function createBenchmarkVaultRegistryRoutes(basePath = '/registry/benchmark-vault') {
  const snapshot = buildBenchmarkVaultSnapshot();
  return [
    { id: 'benchmark-vault.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkVaultRouteSummary(snapshot) },
    { id: 'benchmark-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

