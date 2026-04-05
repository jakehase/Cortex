import { buildBenchmarkFoundrySnapshot, createBenchmarkFoundryReadinessBoard } from '../service-benchmark-foundry.mjs';

export function createBenchmarkFoundryOpsRoutes(basePath = '/ops/benchmark-foundry') {
  const snapshot = buildBenchmarkFoundrySnapshot();
  return [
    { id: 'benchmark-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkFoundryReadinessBoard(snapshot) },
    { id: 'benchmark-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

