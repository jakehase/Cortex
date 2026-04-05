import { buildAttributionHubSnapshot, createAttributionHubReadinessBoard } from '../service-attribution-hub.mjs';

export function createAttributionHubOpsRoutes(basePath = '/ops/attribution-hub') {
  const snapshot = buildAttributionHubSnapshot();
  return [
    { id: 'attribution-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionHubReadinessBoard(snapshot) },
    { id: 'attribution-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

