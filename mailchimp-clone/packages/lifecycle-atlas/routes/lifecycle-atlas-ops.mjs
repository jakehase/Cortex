import { buildLifecycleAtlasSnapshot, createLifecycleAtlasReadinessBoard } from '../service-lifecycle-atlas.mjs';

export function createLifecycleAtlasOpsRoutes(basePath = '/ops/lifecycle-atlas') {
  const snapshot = buildLifecycleAtlasSnapshot();
  return [
    { id: 'lifecycle-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleAtlasReadinessBoard(snapshot) },
    { id: 'lifecycle-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

