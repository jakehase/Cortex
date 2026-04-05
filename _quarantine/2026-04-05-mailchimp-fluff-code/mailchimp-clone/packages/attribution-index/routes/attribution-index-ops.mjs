import { buildAttributionIndexSnapshot, createAttributionIndexReadinessBoard } from '../service-attribution-index.mjs';

export function createAttributionIndexOpsRoutes(basePath = '/ops/attribution-index') {
  const snapshot = buildAttributionIndexSnapshot();
  return [
    { id: 'attribution-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionIndexReadinessBoard(snapshot) },
    { id: 'attribution-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

