import { buildContentWatchtowerSnapshot, createContentWatchtowerReadinessBoard } from '../service-content-watchtower.mjs';

export function createContentWatchtowerOpsRoutes(basePath = '/ops/content-watchtower') {
  const snapshot = buildContentWatchtowerSnapshot();
  return [
    { id: 'content-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentWatchtowerReadinessBoard(snapshot) },
    { id: 'content-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

