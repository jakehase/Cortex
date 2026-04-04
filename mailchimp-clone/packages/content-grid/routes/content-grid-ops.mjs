import { buildContentGridSnapshot, createContentGridReadinessBoard } from '../service-content-grid.mjs';

export function createContentGridOpsRoutes(basePath = '/ops/content-grid') {
  const snapshot = buildContentGridSnapshot();
  return [
    { id: 'content-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentGridReadinessBoard(snapshot) },
    { id: 'content-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

