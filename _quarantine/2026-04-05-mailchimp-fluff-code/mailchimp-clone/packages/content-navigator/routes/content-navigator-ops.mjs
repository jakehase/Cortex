import { buildContentNavigatorSnapshot, createContentNavigatorReadinessBoard } from '../service-content-navigator.mjs';

export function createContentNavigatorOpsRoutes(basePath = '/ops/content-navigator') {
  const snapshot = buildContentNavigatorSnapshot();
  return [
    { id: 'content-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentNavigatorReadinessBoard(snapshot) },
    { id: 'content-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

