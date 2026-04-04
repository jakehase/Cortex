import { buildBenchmarkConsoleSnapshot, createBenchmarkConsoleReadinessBoard } from '../service-benchmark-console.mjs';

export function createBenchmarkConsoleOpsRoutes(basePath = '/ops/benchmark-console') {
  const snapshot = buildBenchmarkConsoleSnapshot();
  return [
    { id: 'benchmark-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkConsoleReadinessBoard(snapshot) },
    { id: 'benchmark-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

