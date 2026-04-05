import { buildContentIndexSnapshot, createContentIndexReadinessBoard } from '../service-content-index.mjs';

export function createContentIndexOpsRoutes(basePath = '/ops/content-index') {
  const snapshot = buildContentIndexSnapshot();
  return [
    { id: 'content-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentIndexReadinessBoard(snapshot) },
    { id: 'content-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

