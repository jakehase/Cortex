import { buildAttributionFoundrySnapshot, createAttributionFoundryReadinessBoard } from '../service-attribution-foundry.mjs';

export function createAttributionFoundryOpsRoutes(basePath = '/ops/attribution-foundry') {
  const snapshot = buildAttributionFoundrySnapshot();
  return [
    { id: 'attribution-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionFoundryReadinessBoard(snapshot) },
    { id: 'attribution-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

