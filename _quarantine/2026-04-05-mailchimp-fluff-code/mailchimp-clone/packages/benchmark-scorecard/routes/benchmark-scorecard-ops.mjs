import { buildBenchmarkScorecardSnapshot, createBenchmarkScorecardReadinessBoard } from '../service-benchmark-scorecard.mjs';

export function createBenchmarkScorecardOpsRoutes(basePath = '/ops/benchmark-scorecard') {
  const snapshot = buildBenchmarkScorecardSnapshot();
  return [
    { id: 'benchmark-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkScorecardReadinessBoard(snapshot) },
    { id: 'benchmark-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

