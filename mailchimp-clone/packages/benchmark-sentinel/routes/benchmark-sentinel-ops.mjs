import { buildBenchmarkSentinelSnapshot, createBenchmarkSentinelReadinessBoard } from '../service-benchmark-sentinel.mjs';

export function createBenchmarkSentinelOpsRoutes(basePath = '/ops/benchmark-sentinel') {
  const snapshot = buildBenchmarkSentinelSnapshot();
  return [
    { id: 'benchmark-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkSentinelReadinessBoard(snapshot) },
    { id: 'benchmark-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

