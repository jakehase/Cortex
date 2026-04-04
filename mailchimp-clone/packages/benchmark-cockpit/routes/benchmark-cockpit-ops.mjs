import { buildBenchmarkCockpitSnapshot, createBenchmarkCockpitReadinessBoard } from '../service-benchmark-cockpit.mjs';

export function createBenchmarkCockpitOpsRoutes(basePath = '/ops/benchmark-cockpit') {
  const snapshot = buildBenchmarkCockpitSnapshot();
  return [
    { id: 'benchmark-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkCockpitReadinessBoard(snapshot) },
    { id: 'benchmark-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

