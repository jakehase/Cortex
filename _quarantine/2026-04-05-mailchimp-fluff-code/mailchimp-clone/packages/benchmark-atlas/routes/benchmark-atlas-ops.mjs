import { buildBenchmarkAtlasSnapshot, createBenchmarkAtlasReadinessBoard } from '../service-benchmark-atlas.mjs';

export function createBenchmarkAtlasOpsRoutes(basePath = '/ops/benchmark-atlas') {
  const snapshot = buildBenchmarkAtlasSnapshot();
  return [
    { id: 'benchmark-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkAtlasReadinessBoard(snapshot) },
    { id: 'benchmark-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

