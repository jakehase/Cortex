import { buildCreativeGridSnapshot, createCreativeGridReadinessBoard } from '../service-creative-grid.mjs';

export function createCreativeGridOpsRoutes(basePath = '/ops/creative-grid') {
  const snapshot = buildCreativeGridSnapshot();
  return [
    { id: 'creative-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeGridReadinessBoard(snapshot) },
    { id: 'creative-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

