import { buildAttributionStudioSnapshot, createAttributionStudioReadinessBoard } from '../service-attribution-studio.mjs';

export function createAttributionStudioOpsRoutes(basePath = '/ops/attribution-studio') {
  const snapshot = buildAttributionStudioSnapshot();
  return [
    { id: 'attribution-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionStudioReadinessBoard(snapshot) },
    { id: 'attribution-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

