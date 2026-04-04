import { buildBenchmarkHubSnapshot, createBenchmarkHubReadinessBoard } from '../service-benchmark-hub.mjs';

export function createBenchmarkHubOpsRoutes(basePath = '/ops/benchmark-hub') {
  const snapshot = buildBenchmarkHubSnapshot();
  return [
    { id: 'benchmark-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkHubReadinessBoard(snapshot) },
    { id: 'benchmark-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

