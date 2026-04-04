import { buildCreativeNavigatorSnapshot, createCreativeNavigatorReadinessBoard } from '../service-creative-navigator.mjs';

export function createCreativeNavigatorOpsRoutes(basePath = '/ops/creative-navigator') {
  const snapshot = buildCreativeNavigatorSnapshot();
  return [
    { id: 'creative-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeNavigatorReadinessBoard(snapshot) },
    { id: 'creative-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

