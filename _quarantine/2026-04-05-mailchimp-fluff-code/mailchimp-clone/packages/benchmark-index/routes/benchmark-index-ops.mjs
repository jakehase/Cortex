import { buildBenchmarkIndexSnapshot, createBenchmarkIndexReadinessBoard } from '../service-benchmark-index.mjs';

export function createBenchmarkIndexOpsRoutes(basePath = '/ops/benchmark-index') {
  const snapshot = buildBenchmarkIndexSnapshot();
  return [
    { id: 'benchmark-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkIndexReadinessBoard(snapshot) },
    { id: 'benchmark-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

