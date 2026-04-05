import { buildContentStudioSnapshot, createContentStudioReadinessBoard } from '../service-content-studio.mjs';

export function createContentStudioOpsRoutes(basePath = '/ops/content-studio') {
  const snapshot = buildContentStudioSnapshot();
  return [
    { id: 'content-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentStudioReadinessBoard(snapshot) },
    { id: 'content-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

