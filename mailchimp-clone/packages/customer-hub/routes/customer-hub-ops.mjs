import { buildCustomerHubSnapshot, createCustomerHubReadinessBoard } from '../service-customer-hub.mjs';

export function createCustomerHubOpsRoutes(basePath = '/ops/customer-hub') {
  const snapshot = buildCustomerHubSnapshot();
  return [
    { id: 'customer-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerHubReadinessBoard(snapshot) },
    { id: 'customer-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

