import { buildContentHubSnapshot, createContentHubReadinessBoard } from '../service-content-hub.mjs';

export function createContentHubOpsRoutes(basePath = '/ops/content-hub') {
  const snapshot = buildContentHubSnapshot();
  return [
    { id: 'content-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentHubReadinessBoard(snapshot) },
    { id: 'content-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

