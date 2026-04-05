import { buildBillingAtlasSnapshot, createBillingAtlasReadinessBoard } from '../service-billing-atlas.mjs';

export function createBillingAtlasOpsRoutes(basePath = '/ops/billing-atlas') {
  const snapshot = buildBillingAtlasSnapshot();
  return [
    { id: 'billing-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingAtlasReadinessBoard(snapshot) },
    { id: 'billing-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

