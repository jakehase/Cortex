import { buildCustomerAtlasSnapshot, createCustomerAtlasReadinessBoard } from '../service-customer-atlas.mjs';

export function createCustomerAtlasOpsRoutes(basePath = '/ops/customer-atlas') {
  const snapshot = buildCustomerAtlasSnapshot();
  return [
    { id: 'customer-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerAtlasReadinessBoard(snapshot) },
    { id: 'customer-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

