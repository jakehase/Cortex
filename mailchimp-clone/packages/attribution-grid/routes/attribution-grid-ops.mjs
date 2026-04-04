import { buildAttributionGridSnapshot, createAttributionGridReadinessBoard } from '../service-attribution-grid.mjs';

export function createAttributionGridOpsRoutes(basePath = '/ops/attribution-grid') {
  const snapshot = buildAttributionGridSnapshot();
  return [
    { id: 'attribution-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionGridReadinessBoard(snapshot) },
    { id: 'attribution-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

