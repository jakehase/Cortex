import { buildCustomerWatchtowerSnapshot, createCustomerWatchtowerReadinessBoard } from '../service-customer-watchtower.mjs';

export function createCustomerWatchtowerOpsRoutes(basePath = '/ops/customer-watchtower') {
  const snapshot = buildCustomerWatchtowerSnapshot();
  return [
    { id: 'customer-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerWatchtowerReadinessBoard(snapshot) },
    { id: 'customer-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

