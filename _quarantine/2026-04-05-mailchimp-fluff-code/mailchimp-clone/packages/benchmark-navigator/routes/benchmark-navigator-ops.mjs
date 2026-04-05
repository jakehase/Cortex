import { buildBenchmarkNavigatorSnapshot, createBenchmarkNavigatorReadinessBoard } from '../service-benchmark-navigator.mjs';

export function createBenchmarkNavigatorOpsRoutes(basePath = '/ops/benchmark-navigator') {
  const snapshot = buildBenchmarkNavigatorSnapshot();
  return [
    { id: 'benchmark-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkNavigatorReadinessBoard(snapshot) },
    { id: 'benchmark-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

