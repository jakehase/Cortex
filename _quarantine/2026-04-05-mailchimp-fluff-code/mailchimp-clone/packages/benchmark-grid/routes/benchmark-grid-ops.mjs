import { buildBenchmarkGridSnapshot, createBenchmarkGridReadinessBoard } from '../service-benchmark-grid.mjs';

export function createBenchmarkGridOpsRoutes(basePath = '/ops/benchmark-grid') {
  const snapshot = buildBenchmarkGridSnapshot();
  return [
    { id: 'benchmark-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkGridReadinessBoard(snapshot) },
    { id: 'benchmark-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

