import { buildBenchmarkVaultSnapshot, createBenchmarkVaultReadinessBoard } from '../service-benchmark-vault.mjs';

export function createBenchmarkVaultOpsRoutes(basePath = '/ops/benchmark-vault') {
  const snapshot = buildBenchmarkVaultSnapshot();
  return [
    { id: 'benchmark-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkVaultReadinessBoard(snapshot) },
    { id: 'benchmark-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

