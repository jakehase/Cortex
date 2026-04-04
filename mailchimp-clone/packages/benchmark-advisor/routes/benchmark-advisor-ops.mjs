import { buildBenchmarkAdvisorSnapshot, createBenchmarkAdvisorReadinessBoard } from '../service-benchmark-advisor.mjs';

export function createBenchmarkAdvisorOpsRoutes(basePath = '/ops/benchmark-advisor') {
  const snapshot = buildBenchmarkAdvisorSnapshot();
  return [
    { id: 'benchmark-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkAdvisorReadinessBoard(snapshot) },
    { id: 'benchmark-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

