import { buildBenchmarkWatchtowerSnapshot, createBenchmarkWatchtowerReadinessBoard } from '../service-benchmark-watchtower.mjs';

export function createBenchmarkWatchtowerOpsRoutes(basePath = '/ops/benchmark-watchtower') {
  const snapshot = buildBenchmarkWatchtowerSnapshot();
  return [
    { id: 'benchmark-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkWatchtowerReadinessBoard(snapshot) },
    { id: 'benchmark-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

