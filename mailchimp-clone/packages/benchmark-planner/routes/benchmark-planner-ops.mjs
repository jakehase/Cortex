import { buildBenchmarkPlannerSnapshot, createBenchmarkPlannerReadinessBoard } from '../service-benchmark-planner.mjs';

export function createBenchmarkPlannerOpsRoutes(basePath = '/ops/benchmark-planner') {
  const snapshot = buildBenchmarkPlannerSnapshot();
  return [
    { id: 'benchmark-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkPlannerReadinessBoard(snapshot) },
    { id: 'benchmark-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

