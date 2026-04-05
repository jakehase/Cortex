import { buildCreativeHubSnapshot, createCreativeHubReadinessBoard } from '../service-creative-hub.mjs';

export function createCreativeHubOpsRoutes(basePath = '/ops/creative-hub') {
  const snapshot = buildCreativeHubSnapshot();
  return [
    { id: 'creative-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeHubReadinessBoard(snapshot) },
    { id: 'creative-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

