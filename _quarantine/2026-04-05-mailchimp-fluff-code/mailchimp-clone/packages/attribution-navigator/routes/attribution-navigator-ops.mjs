import { buildAttributionNavigatorSnapshot, createAttributionNavigatorReadinessBoard } from '../service-attribution-navigator.mjs';

export function createAttributionNavigatorOpsRoutes(basePath = '/ops/attribution-navigator') {
  const snapshot = buildAttributionNavigatorSnapshot();
  return [
    { id: 'attribution-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionNavigatorReadinessBoard(snapshot) },
    { id: 'attribution-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

