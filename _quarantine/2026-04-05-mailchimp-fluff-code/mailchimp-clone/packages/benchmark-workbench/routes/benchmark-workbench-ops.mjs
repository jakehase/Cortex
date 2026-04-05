import { buildBenchmarkWorkbenchSnapshot, createBenchmarkWorkbenchReadinessBoard } from '../service-benchmark-workbench.mjs';

export function createBenchmarkWorkbenchOpsRoutes(basePath = '/ops/benchmark-workbench') {
  const snapshot = buildBenchmarkWorkbenchSnapshot();
  return [
    { id: 'benchmark-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkWorkbenchReadinessBoard(snapshot) },
    { id: 'benchmark-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

